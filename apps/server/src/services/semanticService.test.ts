import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setBackgroundRunner } from "../lib/email/provider.js";
import { setAiRuntimeProvider, type AiBinding, type VectorIndexBinding, type VectorRecord } from "../lib/workersAi.js";
import { createProject, createSubtasks, createTask, deleteTask, listComments, updateTask } from "./taskService.js";
import {
  EMBEDDING_MODEL,
  WHISPER_MODEL,
  findSimilarTasks,
  getAiFeatures,
  reindexAllTasks,
  semanticSearch,
  taskEmbeddingText,
} from "./semanticService.js";
import { bytesToBase64, transcribeVoiceNote } from "./voiceNoteService.js";
import { SYSTEM_ACTOR } from "./notificationService.js";
import { createUser } from "./userService.js";

/**
 * Workers AI e Vectorize simulati: l'embedding e' un bag-of-words su un
 * vocabolario fisso (testi con le stesse parole => vettori vicini), l'indice
 * e' una mappa in memoria con similarita' coseno e filtro `$in`.
 */

const VOCAB = ["login", "lento", "mobile", "password", "fattura", "pdf", "export", "email", "notifiche"];

function embed(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/);
  return VOCAB.map((w) => words.filter((x) => x.startsWith(w)).length + 0.01);
}

function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return dot / (norm(a) * norm(b));
}

let aiCalls: { model: string; input: Record<string, unknown> }[];
let whisperText: string;
let store: Map<string, VectorRecord>;
let pending: Promise<unknown>[];

const fakeAi: AiBinding = {
  async run(model, input) {
    aiCalls.push({ model, input });
    if (model === EMBEDDING_MODEL) return { shape: [], data: (input.text as string[]).map(embed) };
    if (model === WHISPER_MODEL) return { text: whisperText };
    throw new Error(`modello inatteso ${model}`);
  },
};

const fakeVectorize: VectorIndexBinding = {
  async upsert(vectors) {
    for (const v of vectors) store.set(v.id, v);
  },
  async deleteByIds(ids) {
    for (const id of ids) store.delete(id);
  },
  async query(vector, options) {
    const allowed = (options.filter?.projectId as { $in?: string[] } | undefined)?.$in;
    const matches = [...store.values()]
      .filter((v) => !allowed || allowed.includes(String(v.metadata?.projectId)))
      .map((v) => ({ id: v.id, score: cosine(vector, v.values) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK ?? 5);
    return { matches };
  },
};

async function flush() {
  while (pending.length) await Promise.all(pending.splice(0));
}

beforeEach(() => {
  aiCalls = [];
  whisperText = "";
  store = new Map();
  pending = [];
  setBackgroundRunner((task) => pending.push(task));
  setAiRuntimeProvider(() => ({ ai: fakeAi, vectorize: fakeVectorize }));
});

afterEach(() => {
  setAiRuntimeProvider(null);
  setBackgroundRunner((task) => void task);
});

describe("disponibilita'", () => {
  it("tutto spento senza binding (Node/Docker)", async () => {
    setAiRuntimeProvider(null);
    expect(getAiFeatures()).toEqual({ semanticSearch: false, voiceNotes: false, standupSummary: false });
    await expect(semanticSearch({ query: "login", projectIds: undefined })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    // La creazione dei task non dipende dall'indice.
    const project = await createProject("P");
    await createTask(project.id, { title: "Senza AI" });
    expect(pending).toHaveLength(0);
  });

  it("solo AI senza Vectorize: note vocali si', ricerca no", () => {
    setAiRuntimeProvider(() => ({ ai: fakeAi, vectorize: null }));
    expect(getAiFeatures()).toEqual({ semanticSearch: false, voiceNotes: true, standupSummary: true });
  });
});

describe("indicizzazione", () => {
  it("indicizza alla creazione, aggiorna su titolo/descrizione, rimuove all'eliminazione", async () => {
    const project = await createProject("P");
    const task = await createTask(project.id, { title: "Login lento", description: "su mobile" });
    await flush();
    expect(store.get(task.id)?.metadata).toEqual({ projectId: project.id });
    expect(aiCalls.at(-1)?.input).toEqual({ text: ["Login lento\n\nsu mobile"] });

    // Cambio di priorita': nessuna nuova chiamata di embedding.
    const before = aiCalls.length;
    await updateTask(task.id, { priority: "high" });
    await flush();
    expect(aiCalls.length).toBe(before);

    await updateTask(task.id, { title: "Export fattura PDF" });
    await flush();
    expect(aiCalls.length).toBe(before + 1);

    await deleteTask(task.id);
    await flush();
    expect(store.has(task.id)).toBe(false);
  });

  it("indicizza anche le sotto-task create in blocco", async () => {
    const project = await createProject("P");
    const parent = await createTask(project.id, { title: "Epic" });
    const subs = await createSubtasks(project.id, parent.id, [{ title: "Login" }, { title: "Password" }]);
    await flush();
    for (const s of subs) expect(store.has(s.id)).toBe(true);
  });

  it("reindexAllTasks ricostruisce l'indice da zero", async () => {
    const project = await createProject("P");
    setAiRuntimeProvider(null); // task creati prima dell'attivazione
    await createTask(project.id, { title: "Uno" });
    await createTask(project.id, { title: "Due" });
    setAiRuntimeProvider(() => ({ ai: fakeAi, vectorize: fakeVectorize }));
    expect(store.size).toBe(0);
    expect(await reindexAllTasks()).toEqual({ indexed: 2 });
    expect(store.size).toBe(2);
  });

  it("taskEmbeddingText tronca i testi lunghi", () => {
    expect(taskEmbeddingText({ title: "T", description: "x".repeat(5000) }).length).toBe(2000);
    expect(taskEmbeddingText({ title: " Solo titolo ", description: "" })).toBe("Solo titolo");
  });
});

describe("ricerca", () => {
  async function seed() {
    const a = await createProject("A");
    const b = await createProject("B");
    const login = await createTask(a.id, { title: "Login lento su mobile" });
    const fattura = await createTask(a.id, { title: "Export fattura in PDF" });
    const foreign = await createTask(b.id, { title: "Login lento" });
    await flush();
    return { a, b, login, fattura, foreign };
  }

  it("ordina per somiglianza e rispetta i progetti ammessi", async () => {
    const { a, login, foreign } = await seed();
    const results = await semanticSearch({ query: "il login è lento", projectIds: [a.id] });
    expect(results.map((r) => r.taskId)).toEqual([login.id]);
    expect(results[0]).toMatchObject({ projectId: a.id, title: "Login lento su mobile", status: "draft" });
    expect(results.some((r) => r.taskId === foreign.id)).toBe(false);

    const all = await semanticSearch({ query: "login lento", projectIds: undefined });
    expect(all.map((r) => r.taskId).sort()).toEqual([login.id, foreign.id].sort());
  });

  it("lista progetti vuota o query vuota: nessun risultato", async () => {
    await seed();
    expect(await semanticSearch({ query: "login", projectIds: [] })).toEqual([]);
    expect(await semanticSearch({ query: "   ", projectIds: undefined })).toEqual([]);
  });

  it("ignora i vettori di task non piu' esistenti", async () => {
    const { a } = await seed();
    store.set("fantasma", { id: "fantasma", values: embed("login lento"), metadata: { projectId: a.id } });
    const results = await semanticSearch({ query: "login lento", projectIds: [a.id] });
    expect(results.some((r) => r.taskId === "fantasma")).toBe(false);
  });

  it("findSimilarTasks segnala i duplicati solo sopra la soglia ed esclude il task stesso", async () => {
    const { a, login } = await seed();
    const dup = await findSimilarTasks(a.id, { title: "Login lento", description: "da mobile" });
    expect(dup.map((d) => d.taskId)).toEqual([login.id]);
    expect(await findSimilarTasks(a.id, { title: "Notifiche email" })).toEqual([]);
    expect(await findSimilarTasks(a.id, { title: "Login lento su mobile", excludeTaskId: login.id })).toEqual([]);
  });
});

describe("note vocali", () => {
  it("trascrive e salva un commento con l'attore", async () => {
    const project = await createProject("P");
    const user = await createUser({ email: "u@example.com", password: "password-123", role: "admin" });
    const task = await createTask(project.id, { title: "T" });
    whisperText = "  Ricordarsi di testare il login su iPhone  ";

    const result = await transcribeVoiceNote(
      task.id,
      { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm;codecs=opus", language: "it" },
      { type: "user", id: user.id },
    );
    expect(result.transcript).toBe("Ricordarsi di testare il login su iPhone");
    expect(aiCalls.at(-1)).toMatchObject({
      model: WHISPER_MODEL,
      input: { audio: bytesToBase64(new Uint8Array([1, 2, 3])), language: "it", task: "transcribe" },
    });
    const comments = await listComments(task.id);
    expect(comments.at(-1)?.body).toContain("Ricordarsi di testare il login su iPhone");
  });

  it("rifiuta audio vuoto, formati non audio e trascrizioni vuote", async () => {
    const project = await createProject("P");
    const task = await createTask(project.id, { title: "T" });
    const actor = SYSTEM_ACTOR;
    await expect(
      transcribeVoiceNote(task.id, { bytes: new Uint8Array(), mimeType: "audio/webm" }, actor),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      transcribeVoiceNote(task.id, { bytes: new Uint8Array([1]), mimeType: "image/png" }, actor),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TYPE_NOT_ALLOWED" });
    whisperText = "   ";
    await expect(
      transcribeVoiceNote(task.id, { bytes: new Uint8Array([1]), mimeType: "audio/mp4" }, actor),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await listComments(task.id)).toHaveLength(0);
  });

  it("senza Workers AI risponde AI_UNAVAILABLE", async () => {
    setAiRuntimeProvider(null);
    const project = await createProject("P");
    const task = await createTask(project.id, { title: "T" });
    await expect(
      transcribeVoiceNote(task.id, { bytes: new Uint8Array([1]), mimeType: "audio/webm" }, SYSTEM_ACTOR),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });

  it("bytesToBase64 coincide con Buffer anche oltre il blocco da 32KB", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
