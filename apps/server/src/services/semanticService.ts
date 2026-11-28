import type { AiFeatures, SemanticTaskMatch } from "@my-planner/core";
import { ApiErrorException } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { runInBackground } from "../lib/email/provider.js";
import { getAiRuntime, type AiBinding, type VectorIndexBinding } from "../lib/workersAi.js";

/**
 * Ricerca semantica sui task con Workers AI (embedding) + Vectorize (indice).
 *
 * Ogni task ha un vettore con id = taskId e metadato `projectId` (indicizzato,
 * per filtrare per progetto). Il vettore si aggiorna in background quando un
 * task nasce o cambiano titolo/descrizione, e sparisce quando il task viene
 * eliminato; `reindexAllTasks` ricostruisce l'indice da zero (task esistenti
 * prima dell'attivazione, o dopo un cambio di modello).
 *
 * Modello: bge-m3, multilingue (i task sono in italiano), 1024 dimensioni:
 * l'indice Vectorize va creato con `--dimensions=1024 --metric=cosine`.
 *
 * Senza binding (Node/Docker) ogni funzione di indicizzazione e' un no-op e
 * la ricerca risponde AI_UNAVAILABLE: la UI la nasconde (GET /ai/features).
 */

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const SUMMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Testo massimo per l'embedding: titolo + inizio della descrizione. */
const MAX_EMBED_CHARS = 2000;
/** Task per chiamata di embedding durante la reindicizzazione. */
const REINDEX_BATCH = 50;

/** Sotto questa somiglianza un risultato della ricerca non e' pertinente. */
export const SEARCH_MIN_SCORE = 0.45;
/** Da questa somiglianza in su un task esistente e' un possibile duplicato. */
export const DUPLICATE_MIN_SCORE = 0.72;

export function getAiFeatures(): AiFeatures {
  const { ai, vectorize } = getAiRuntime();
  return {
    semanticSearch: Boolean(ai && vectorize),
    voiceNotes: Boolean(ai),
    standupSummary: Boolean(ai),
  };
}

function requireSearchRuntime(): { ai: AiBinding; vectorize: VectorIndexBinding } {
  const { ai, vectorize } = getAiRuntime();
  if (!ai || !vectorize) {
    throw new ApiErrorException("AI_UNAVAILABLE", "Ricerca semantica non disponibile su questa installazione");
  }
  return { ai, vectorize };
}

/** Testo indicizzato di un task. */
export function taskEmbeddingText(task: { title: string; description: string | null }): string {
  const description = (task.description ?? "").trim();
  return (description ? `${task.title.trim()}\n\n${description}` : task.title.trim()).slice(0, MAX_EMBED_CHARS);
}

/** Errore di Workers AI tradotto in un messaggio comprensibile (quota giornaliera inclusa). */
export function aiProviderError(err: unknown): ApiErrorException {
  const message = err instanceof Error ? err.message : String(err);
  if (/neuron|quota|limit|429|3036|4006/i.test(message)) {
    return new ApiErrorException("AI_PROVIDER_ERROR", "Quota gratuita giornaliera di Workers AI esaurita, riprova domani");
  }
  return new ApiErrorException("AI_PROVIDER_ERROR", `Workers AI: ${message}`);
}

export async function embedTexts(ai: AiBinding, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  let out: unknown;
  try {
    out = await ai.run(EMBEDDING_MODEL, { text: texts });
  } catch (err) {
    throw aiProviderError(err);
  }
  const data = (out as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length !== texts.length || !data.every((v) => Array.isArray(v))) {
    throw new ApiErrorException("AI_PROVIDER_ERROR", "Workers AI: risposta di embedding non valida");
  }
  return data as number[][];
}

// ---------------------------------------------------------------------------
// Indicizzazione
// ---------------------------------------------------------------------------

/** Aggiorna (o rimuove, se il task non esiste piu') il vettore di un task. */
export async function indexTask(taskId: string): Promise<void> {
  const { ai, vectorize } = getAiRuntime();
  if (!ai || !vectorize) return;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, title: true, description: true },
  });
  if (!task) {
    await vectorize.deleteByIds([taskId]);
    return;
  }
  const [values] = await embedTexts(ai, [taskEmbeddingText(task)]);
  await vectorize.upsert([{ id: task.id, values, metadata: { projectId: task.projectId } }]);
}

/** Indicizza in background, senza rallentare la risposta (no-op senza binding). */
export function scheduleTaskIndex(taskIds: string | string[]): void {
  const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
  const { ai, vectorize } = getAiRuntime();
  if (!ai || !vectorize || ids.length === 0) return;
  runInBackground("indicizzazione semantica non riuscita", async () => {
    for (const id of ids) await indexTask(id);
  });
}

/** Rimuove in background il vettore di un task eliminato. */
export function scheduleTaskRemoval(taskId: string): void {
  const { vectorize } = getAiRuntime();
  if (!vectorize) return;
  runInBackground("rimozione dall'indice semantico non riuscita", () => vectorize.deleteByIds([taskId]));
}

/**
 * Ricostruisce l'indice di tutti i task (solo admin). Sincrono: con D1 e
 * batch da 50 regge qualche migliaio di task per richiesta.
 */
export async function reindexAllTasks(): Promise<{ indexed: number }> {
  const { ai, vectorize } = requireSearchRuntime();
  let indexed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.task.findMany({
      select: { id: true, projectId: true, title: true, description: true },
      orderBy: { id: "asc" },
      take: REINDEX_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    const vectors = await embedTexts(ai, batch.map(taskEmbeddingText));
    await vectorize.upsert(
      batch.map((t, i) => ({ id: t.id, values: vectors[i], metadata: { projectId: t.projectId } })),
    );
    indexed += batch.length;
    cursor = batch[batch.length - 1].id;
    if (batch.length < REINDEX_BATCH) break;
  }
  return { indexed };
}

// ---------------------------------------------------------------------------
// Ricerca
// ---------------------------------------------------------------------------

export interface SemanticSearchInput {
  query: string;
  /** Progetti in cui cercare; undefined = tutti (solo admin). */
  projectIds: string[] | undefined;
  limit?: number;
  minScore?: number;
  excludeTaskId?: string;
}

export async function semanticSearch(input: SemanticSearchInput): Promise<SemanticTaskMatch[]> {
  const query = input.query.trim().slice(0, MAX_EMBED_CHARS);
  if (!query) return [];
  if (input.projectIds && input.projectIds.length === 0) return [];
  const { ai, vectorize } = requireSearchRuntime();

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const minScore = input.minScore ?? SEARCH_MIN_SCORE;
  const [vector] = await embedTexts(ai, [query]);

  let result: { matches: { id: string; score: number }[] };
  try {
    result = await vectorize.query(vector, {
      // Uno in piu' per poter scartare il task escluso senza perdere un risultato.
      topK: limit + (input.excludeTaskId ? 1 : 0),
      returnMetadata: "none",
      ...(input.projectIds ? { filter: { projectId: { $in: input.projectIds } } } : {}),
    });
  } catch (err) {
    throw new ApiErrorException("AI_PROVIDER_ERROR", `Vectorize: ${err instanceof Error ? err.message : err}`);
  }

  const scores = new Map<string, number>();
  for (const m of result.matches ?? []) {
    if (m.score >= minScore && m.id !== input.excludeTaskId) scores.set(m.id, m.score);
  }
  if (scores.size === 0) return [];

  // L'indice puo' essere indietro rispetto al DB: si tengono solo i task che
  // esistono ancora e stanno nei progetti ammessi (il filtro Vectorize e'
  // gia' applicato, questo e' il controllo autorevole).
  const allowed = input.projectIds ? new Set(input.projectIds) : null;
  const tasks = await prisma.task.findMany({
    where: { id: { in: [...scores.keys()] } },
    select: { id: true, projectId: true, title: true, status: true },
  });
  return tasks
    .filter((t) => !allowed || allowed.has(t.projectId))
    .map((t) => ({ taskId: t.id, projectId: t.projectId, title: t.title, status: t.status, score: scores.get(t.id)! }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Possibili duplicati di un task in scrittura, nello stesso progetto. */
export async function findSimilarTasks(
  projectId: string,
  input: { title: string; description?: string; excludeTaskId?: string },
): Promise<SemanticTaskMatch[]> {
  const text = taskEmbeddingText({ title: input.title, description: input.description ?? "" });
  if (text.length < 3) return [];
  return semanticSearch({
    query: text,
    projectIds: [projectId],
    limit: 5,
    minScore: DUPLICATE_MIN_SCORE,
    excludeTaskId: input.excludeTaskId,
  });
}
