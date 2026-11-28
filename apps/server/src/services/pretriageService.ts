import type { Comment, PretriageResponse, PretriageResult, PretriageStatus, TaskComplexity, TaskPriority } from "@my-planner/core";
import { ApiErrorException, FIBONACCI_COMPLEXITY } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { GEMINI_BASE_URL, decryptApiKey, fetchModelMetadata, providerError, readProviderError } from "./geminiCommon.js";
import type { Actor } from "./notificationService.js";
import { addComment, getTaskOrThrow, tagsToArray } from "./taskService.js";
import { findVoiceSettingsRow } from "./voiceService.js";

/**
 * Pre-triage di un task con Gemini (modello di testo, piano gratuito), lanciato
 * su richiesta dal drawer da qualsiasi utente con accesso al task.
 *
 * Usa la chiave API dell'assistente vocale (VoiceSettings, cifrata) e il
 * modello `pretriageModel`. Chiede a Gemini un JSON strutturato
 * (responseSchema), lo ripulisce, ne fa un commento markdown aggiunto al task
 * con l'attore di chi l'ha lanciato. Non modifica mai i campi del task.
 * Solo `fetch`: gira uguale su Node e sul Worker.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
/** Altri task aperti del progetto passati al modello per i duplicati (solo titoli). */
const MAX_OTHER_TASKS = 50;
const MAX_DESCRIPTION_CHARS = 8000;
const MAX_LIST_ITEMS = 15;
const MAX_ITEM_CHARS = 500;
const MAX_SUMMARY_CHARS = 1000;

const PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];
const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "bassa", medium: "media", high: "alta", urgent: "urgente" };
const TYPE_LABEL: Record<string, string> = { bug: "bug", feature: "nuova funzionalità", analysis: "analisi" };

const QUOTA_MESSAGE = "Quota gratuita di Gemini esaurita per oggi, riprova piu' tardi";

export async function getPretriageStatus(): Promise<PretriageStatus> {
  const row = await findVoiceSettingsRow();
  return { available: Boolean(row?.pretriageEnabled && row.apiKeyEnc) };
}

/**
 * Verifica chiave e modello del pre-triage salvati (anche se non ancora
 * attivo) leggendo i metadati del modello: nessun costo di generazione.
 */
export async function testPretriageSettings(): Promise<{ ok: true; model: string }> {
  const row = await findVoiceSettingsRow();
  if (!row?.apiKeyEnc) throw new ApiErrorException("VALIDATION_ERROR", "Salva prima la chiave API");
  const apiKey = await decryptApiKey(row.apiKeyEnc, "PRETRIAGE_UNAVAILABLE");
  await fetchModelMetadata(apiKey, row.pretriageModel, "PRETRIAGE_PROVIDER_ERROR");
  return { ok: true, model: row.pretriageModel };
}

/** Schema della risposta (sottoinsieme OpenAPI di Gemini). */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    ready: { type: "BOOLEAN", description: "true se il task e' pronto per il triage" },
    missing: { type: "ARRAY", items: { type: "STRING" }, description: "Informazioni mancanti" },
    ambiguities: { type: "ARRAY", items: { type: "STRING" }, description: "Punti ambigui o contraddittori" },
    suggestedPriority: { type: "STRING", enum: [...PRIORITIES] },
    suggestedComplexity: {
      type: "INTEGER",
      description: `Story point, uno tra ${FIBONACCI_COMPLEXITY.join(", ")}`,
    },
    possibleDuplicates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { taskId: { type: "STRING" }, title: { type: "STRING" } },
        required: ["taskId", "title"],
      },
    },
    summary: { type: "STRING", description: "Valutazione in una o due frasi" },
  },
  required: ["ready", "missing", "ambiguities", "suggestedPriority", "suggestedComplexity", "possibleDuplicates", "summary"],
  propertyOrdering: [
    "ready",
    "summary",
    "missing",
    "ambiguities",
    "suggestedPriority",
    "suggestedComplexity",
    "possibleDuplicates",
  ],
};

const SYSTEM_PROMPT = `Sei un assistente che fa il pre-triage dei task di un gestionale di progetto.
Valuta se il task e' pronto per il triage, cioe' se uno sviluppatore potrebbe stimarlo e lavorarci senza dover chiedere altro.
Controlla in particolare: criteri di accettazione, file o aree del codice coinvolte, come verificare il risultato e, se e' un bug, i passi per riprodurlo con comportamento atteso e osservato.
Regole:
- "missing": informazioni che mancano e servirebbero (frasi brevi e concrete). Vuoto se non manca nulla di importante.
- "ambiguities": punti vaghi, contraddittori o interpretabili in piu' modi.
- "ready": true solo se non manca nulla di essenziale.
- "suggestedPriority": low, medium, high o urgent.
- "suggestedComplexity": story point Fibonacci tra ${FIBONACCI_COMPLEXITY.join(", ")}.
- "possibleDuplicates": SOLO task della lista "Altri task aperti" che sembrano lo stesso lavoro; usa esattamente il loro id. Lista vuota se non ce ne sono.
- "summary": una o due frasi.
Non inventare dettagli sul progetto. Scrivi tutti i testi nella stessa lingua della descrizione del task (se la descrizione e' vuota, nella lingua del titolo).`;

interface TaskForPrompt {
  title: string;
  type: string;
  priority: string;
  complexity: number | null;
  tags: string;
  description: string;
}

function buildUserPrompt(task: TaskForPrompt, others: { id: string; title: string; status: string }[]): string {
  const description = task.description.trim();
  const lines = [
    "## Task da valutare",
    `Titolo: ${task.title}`,
    `Tipo: ${task.type}`,
    `Priorita' attuale: ${task.priority}`,
    `Complessita' attuale: ${task.complexity ?? "non stimata"}`,
    `Tag: ${tagsToArray(task.tags).join(", ") || "nessuno"}`,
    "Descrizione:",
    description ? description.slice(0, MAX_DESCRIPTION_CHARS) : "(vuota)",
    "",
    "## Altri task aperti dello stesso progetto (id | stato | titolo)",
    ...(others.length ? others.map((o) => `${o.id} | ${o.status} | ${o.title}`) : ["(nessuno)"]),
  ];
  return lines.join("\n");
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, MAX_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

/** Valore Fibonacci ammesso piu' vicino, a pari distanza il maggiore (null se non numerico). */
function cleanComplexity(value: unknown): TaskComplexity | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  let best: TaskComplexity = FIBONACCI_COMPLEXITY[0];
  for (const c of FIBONACCI_COMPLEXITY) if (Math.abs(c - n) <= Math.abs(best - n)) best = c;
  return best;
}

/**
 * Normalizza il JSON del modello: tipi garantiti, priorita'/complessita' solo
 * valori ammessi, duplicati solo tra i task passati (titolo preso dal DB).
 */
export function sanitizePretriage(
  raw: unknown,
  others: { id: string; title: string }[],
  model: string,
): PretriageResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiErrorException("PRETRIAGE_PROVIDER_ERROR", "Gemini ha restituito una risposta non valida");
  }
  const r = raw as Record<string, unknown>;
  const byId = new Map(others.map((o) => [o.id, o.title]));
  const seen = new Set<string>();
  const possibleDuplicates: { taskId: string; title: string }[] = [];
  if (Array.isArray(r.possibleDuplicates)) {
    for (const d of r.possibleDuplicates) {
      const id = d && typeof d === "object" ? (d as { taskId?: unknown }).taskId : undefined;
      if (typeof id !== "string" || !byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      possibleDuplicates.push({ taskId: id, title: byId.get(id)! });
    }
  }
  const priority = typeof r.suggestedPriority === "string" ? r.suggestedPriority.trim().toLowerCase() : "";
  return {
    ready: r.ready === true,
    missing: cleanList(r.missing),
    ambiguities: cleanList(r.ambiguities),
    suggestedPriority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as TaskPriority) : null,
    suggestedComplexity: cleanComplexity(r.suggestedComplexity),
    possibleDuplicates,
    summary: typeof r.summary === "string" ? r.summary.trim().slice(0, MAX_SUMMARY_CHARS) : "",
    model,
  };
}

/** Il titolo come testo di un link markdown: niente parentesi quadre o a capo. */
function linkText(title: string): string {
  return title.replace(/[\r\n]+/g, " ").replace(/[[\]\\]/g, "\\$&");
}

/** Commento markdown leggibile dall'esito del pre-triage. */
export function buildPretriageComment(result: PretriageResult, projectId: string): string {
  const out: string[] = [`### Pre-triage (Gemini · ${result.model})`, ""];
  out.push(result.ready ? "✅ **Pronto per il triage**" : "⚠️ **Da completare**");
  if (result.summary) out.push("", result.summary);

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    out.push("", `**${title}**`, ...items.map((i) => `- ${i.replace(/[\r\n]+/g, " ")}`));
  };
  section("Cosa manca", result.missing);
  section("Ambiguità", result.ambiguities);

  const hints: string[] = [];
  if (result.suggestedPriority) hints.push(`Priorità: ${PRIORITY_LABEL[result.suggestedPriority]}`);
  if (result.suggestedComplexity) hints.push(`Complessità: ${result.suggestedComplexity}`);
  section("Suggerimenti", hints);

  section(
    "Possibili duplicati",
    result.possibleDuplicates.map(
      (d) =>
        `[${linkText(d.title)}](/projects/${encodeURIComponent(projectId)}?task=${encodeURIComponent(d.taskId)})`,
    ),
  );
  out.push("", "_Suggerimenti automatici: il task non è stato modificato._");
  return out.join("\n");
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

async function callGemini(apiKey: string, model: string, userPrompt: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  let data: GeminiResponse;
  try {
    try {
      res = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ApiErrorException(
          "PRETRIAGE_PROVIDER_ERROR",
          `Gemini non ha risposto entro ${Math.round(timeoutMs / 1000)} secondi, riprova`,
        );
      }
      throw new ApiErrorException(
        "PRETRIAGE_PROVIDER_ERROR",
        `Gemini non raggiungibile: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (res.status === 429) throw new ApiErrorException("PRETRIAGE_QUOTA", QUOTA_MESSAGE);
    if (!res.ok) {
      const { message, status } = await readProviderError(res.clone());
      if (status === "RESOURCE_EXHAUSTED") throw new ApiErrorException("PRETRIAGE_QUOTA", QUOTA_MESSAGE);
      throw new ApiErrorException("PRETRIAGE_PROVIDER_ERROR", message ? `Gemini: ${message}` : await providerError(res));
    }
    try {
      data = (await res.json()) as GeminiResponse;
    } catch {
      throw new ApiErrorException("PRETRIAGE_PROVIDER_ERROR", "Gemini ha restituito una risposta non valida");
    }
  } finally {
    clearTimeout(timer);
  }

  if (data.promptFeedback?.blockReason) {
    throw new ApiErrorException(
      "PRETRIAGE_PROVIDER_ERROR",
      `Gemini ha bloccato la richiesta (${data.promptFeedback.blockReason})`,
    );
  }
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ApiErrorException("PRETRIAGE_PROVIDER_ERROR", "Gemini non ha restituito una risposta");
  try {
    // Alcuni modelli racchiudono comunque il JSON in un blocco ```json.
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new ApiErrorException("PRETRIAGE_PROVIDER_ERROR", "Gemini ha restituito una risposta non valida (JSON atteso)");
  }
}

/**
 * Esegue il pre-triage e aggiunge il commento al task (stessa funzione delle
 * route dei commenti, quindi compare anche nell'attivita'). Il controllo di
 * accesso al task (`assertTaskAccess`) spetta alla route.
 */
export async function runPretriage(
  taskId: string,
  actor: Actor,
  options: { timeoutMs?: number } = {},
): Promise<PretriageResponse> {
  const row = await findVoiceSettingsRow();
  if (!row?.pretriageEnabled || !row.apiKeyEnc) {
    throw new ApiErrorException("PRETRIAGE_UNAVAILABLE", "Pre-triage non attivo: un amministratore deve attivarlo nelle impostazioni Gemini");
  }
  const task = await getTaskOrThrow(taskId);
  const apiKey = await decryptApiKey(row.apiKeyEnc, "PRETRIAGE_UNAVAILABLE");

  const others = await prisma.task.findMany({
    where: { projectId: task.projectId, id: { not: task.id }, status: { not: "done" } },
    select: { id: true, title: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_OTHER_TASKS,
  });

  const prompt = buildUserPrompt(
    {
      title: task.title,
      type: TYPE_LABEL[task.type] ?? task.type,
      priority: task.priority,
      complexity: task.complexity,
      tags: task.tags,
      description: task.description,
    },
    others,
  );
  const raw = await callGemini(apiKey, row.pretriageModel, prompt, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const result = sanitizePretriage(raw, others, row.pretriageModel);
  const comment = await addComment(task.id, buildPretriageComment(result, task.projectId), actor);
  return { result, comment: comment as unknown as Comment };
}
