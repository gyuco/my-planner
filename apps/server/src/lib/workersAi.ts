/**
 * Workers AI e Vectorize: punto di iniezione runtime, sul modello di
 * lib/realtime.ts e lib/email/provider.ts.
 *
 *  - Worker Cloudflare: src/cf/index.ts registra un provider che legge i
 *    binding `AI` e `VECTORIZE` dell'invocazione corrente;
 *  - Node/Docker: nessun provider, quindi niente ricerca semantica, note
 *    vocali o riassunto dello standup (GET /ai/features risponde tutto false).
 *
 * Le interfacce qui sotto sono il sottoinsieme minimo dei tipi di
 * @cloudflare/workers-types che il service layer usa, cosi' il codice
 * condiviso compila anche su Node senza i tipi dei Worker.
 */

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface VectorIndexBinding {
  upsert(vectors: VectorRecord[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  query(
    vector: number[],
    options: { topK?: number; filter?: Record<string, unknown>; returnMetadata?: boolean | "none" | "indexed" | "all" },
  ): Promise<{ matches: VectorMatch[] }>;
}

export interface AiRuntime {
  ai: AiBinding | null;
  vectorize: VectorIndexBinding | null;
}

type AiRuntimeProvider = () => AiRuntime | null;

let provider: AiRuntimeProvider | null = null;

export function setAiRuntimeProvider(p: AiRuntimeProvider | null) {
  provider = p;
}

/** Binding dell'invocazione corrente; `{ ai: null, vectorize: null }` se assenti. */
export function getAiRuntime(): AiRuntime {
  return provider?.() ?? { ai: null, vectorize: null };
}
