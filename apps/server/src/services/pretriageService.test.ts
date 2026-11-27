import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/prisma.js";
import { getPretriageStatus, runPretriage, testPretriageSettings } from "./pretriageService.js";
import { updateVoiceSettings } from "./voiceService.js";
import { createProject, createTask, listComments } from "./taskService.js";
import { createUser } from "./userService.js";
import { userActor } from "./notificationService.js";

/** Pre-triage con Gemini (fetch simulato): stessa chiave dell'assistente vocale. */

const API_KEY = "AIzaSyTEST-0123456789abcdefghijkl";
let calls: { url: string; init: RequestInit }[] = [];
let nextResponse: () => Response = () => Response.json({});

/** Risposta generateContent con `payload` come testo JSON. */
function geminiJson(payload: unknown): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

beforeEach(() => {
  calls = [];
  nextResponse = () => Response.json({});
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return nextResponse();
  });
});

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const project = await createProject("Clinica");
  const manager = await createUser({
    email: "manager@example.com",
    password: "password-123",
    role: "manager",
    projectIds: [project.id],
  });
  const task = await createTask(project.id, {
    title: "Login lento",
    description: "Il login ci mette troppo",
    type: "bug",
    priority: "low",
    tags: ["auth"],
  });
  const other = await createTask(project.id, { title: "Login lentissimo su mobile" });
  const done = await createTask(project.id, { title: "Vecchio task chiuso" });
  await prisma.task.update({ where: { id: done.id }, data: { status: "done" } });
  return { project, manager, task, other, done };
}

describe("disponibilita' e verifica", () => {
  it("disponibile solo se attivo e con chiave (anche ad assistente vocale spento)", async () => {
    expect(await getPretriageStatus()).toEqual({ available: false });
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY });
    expect(await getPretriageStatus()).toEqual({ available: false });
    await updateVoiceSettings({ enabled: false, pretriageEnabled: true });
    expect(await getPretriageStatus()).toEqual({ available: true });
  });

  it("il test legge i metadati del modello di testo", async () => {
    await expect(testPretriageSettings()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY });
    nextResponse = () => Response.json({ name: "models/gemini-flash-lite-latest" });
    expect(await testPretriageSettings()).toEqual({ ok: true, model: "gemini-flash-lite-latest" });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe(API_KEY);

    nextResponse = () => Response.json({ error: { message: "model not found" } }, { status: 404 });
    await expect(testPretriageSettings()).rejects.toMatchObject({
      code: "PRETRIAGE_PROVIDER_ERROR",
      message: "Gemini: model not found",
    });
  });
});

describe("runPretriage", () => {
  it("non disponibile: errore chiaro e nessuna chiamata a Gemini", async () => {
    const { task, manager } = await setup();
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({
      code: "PRETRIAGE_UNAVAILABLE",
    });
    await updateVoiceSettings({ enabled: true, apiKey: API_KEY });
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({
      code: "PRETRIAGE_UNAVAILABLE",
    });
    expect(calls).toHaveLength(0);
  });

  it("chiama generateContent con JSON strutturato, filtra i duplicati inventati e commenta senza toccare il task", async () => {
    const { task, other, done, manager, project } = await setup();
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });
    const before = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });

    nextResponse = () =>
      geminiJson({
        ready: false,
        missing: ["Passi per riprodurre", "  ", 42],
        ambiguities: ["Quanto e' 'troppo'?"],
        suggestedPriority: "high",
        suggestedComplexity: 4,
        possibleDuplicates: [
          { taskId: other.id, title: "titolo inventato dal modello" },
          { taskId: "id-inventato", title: "Non esiste" },
          { taskId: done.id, title: "Vecchio task chiuso" },
          { taskId: other.id, title: "doppio" },
        ],
        summary: "Manca come riprodurre il problema.",
      });

    const { result, comment } = await runPretriage(task.id, userActor(manager as any));

    // Richiesta
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent",
    );
    expect(url).not.toContain(API_KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(API_KEY);
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toContain("possibleDuplicates");
    const prompt: string = body.contents[0].parts[0].text;
    expect(prompt).toContain("Titolo: Login lento");
    expect(prompt).toContain("Il login ci mette troppo");
    expect(prompt).toContain("Tag: auth");
    expect(prompt).toContain(`${other.id} | draft | Login lentissimo su mobile`);
    expect(prompt).not.toContain(done.id); // solo task aperti

    // Esito ripulito
    expect(result).toEqual({
      ready: false,
      missing: ["Passi per riprodurre"],
      ambiguities: ["Quanto e' 'troppo'?"],
      suggestedPriority: "high",
      suggestedComplexity: 5,
      possibleDuplicates: [{ taskId: other.id, title: "Login lentissimo su mobile" }],
      summary: "Manca come riprodurre il problema.",
      model: "gemini-flash-lite-latest",
    });

    // Commento
    expect(comment.taskId).toBe(task.id);
    expect(comment.body).toContain("### Pre-triage (Gemini · gemini-flash-lite-latest)");
    expect(comment.body).toContain("⚠️ **Da completare**");
    expect(comment.body).toContain("**Cosa manca**\n- Passi per riprodurre");
    expect(comment.body).toContain("- Priorità: alta");
    expect(comment.body).toContain("- Complessità: 5");
    expect(comment.body).toContain(`[Login lentissimo su mobile](/projects/${project.id}?task=${other.id})`);
    expect(comment.body).not.toContain("id-inventato");
    expect((await listComments(task.id)).map((c) => c.id)).toEqual([comment.id]);

    // Evento di attivita' con l'attore di chi l'ha lanciato
    const event = await prisma.taskEvent.findFirstOrThrow({ where: { taskId: task.id, type: "comment.created" } });
    expect(event.actorId).toBe(manager.id);

    // Nessun campo del task modificato
    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after).toEqual(before);
  });

  it("task pronto: esito positivo", async () => {
    const { task, manager } = await setup();
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });
    nextResponse = () =>
      geminiJson({
        ready: true,
        missing: [],
        ambiguities: [],
        suggestedPriority: "boh",
        suggestedComplexity: null,
        possibleDuplicates: [],
        summary: "Tutto chiaro.",
      });
    const { result, comment } = await runPretriage(task.id, userActor(manager as any));
    expect(result).toMatchObject({ ready: true, suggestedPriority: null, suggestedComplexity: null });
    expect(comment.body).toContain("✅ **Pronto per il triage**");
    expect(comment.body).not.toContain("**Suggerimenti**");
  });

  it("429 / RESOURCE_EXHAUSTED: errore quota", async () => {
    const { task, manager } = await setup();
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });
    nextResponse = () =>
      Response.json({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({
      code: "PRETRIAGE_QUOTA",
      message: "Quota gratuita di Gemini esaurita per oggi, riprova piu' tardi",
    });

    nextResponse = () =>
      Response.json({ error: { message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }, { status: 403 });
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({ code: "PRETRIAGE_QUOTA" });
    expect(await listComments(task.id)).toHaveLength(0);
  });

  it("altri errori: messaggio del provider; risposta non JSON: errore pulito", async () => {
    const { task, manager } = await setup();
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });

    nextResponse = () => Response.json({ error: { message: "API key not valid" } }, { status: 400 });
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({
      code: "PRETRIAGE_PROVIDER_ERROR",
      message: "Gemini: API key not valid",
    });

    nextResponse = () => Response.json({ candidates: [{ content: { parts: [{ text: "non e' json" }] } }] });
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({
      code: "PRETRIAGE_PROVIDER_ERROR",
    });

    nextResponse = () => geminiJson(["array", "non oggetto"]);
    await expect(runPretriage(task.id, userActor(manager as any))).rejects.toMatchObject({
      code: "PRETRIAGE_PROVIDER_ERROR",
    });
    expect(await listComments(task.id)).toHaveLength(0);
  });

  it("timeout: interrompe la richiesta", async () => {
    const { task, manager } = await setup();
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    await expect(runPretriage(task.id, userActor(manager as any), { timeoutMs: 20 })).rejects.toMatchObject({
      code: "PRETRIAGE_PROVIDER_ERROR",
      message: expect.stringContaining("non ha risposto"),
    });
  });
});
