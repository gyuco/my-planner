import type { ExecutionContext } from "@cloudflare/workers-types";
import { buildRestApp, bootstrapUserOnWorker } from "./rest.js";
import { initD1Prisma } from "./db.js";
import { setAttachmentStorageFactory } from "../lib/attachmentStorage/provider.js";
import { createR2AttachmentStorage } from "./storage/r2.js";
import { handleMcpRequest, handleMcpAttachmentDownload } from "./mcp.js";
import type { CfEnv } from "./env.js";

/**
 * Entry point del Worker Cloudflare (CF1/CF3).
 * Routing:
 *   GET  /mcp/attachments/:id/download -> stream R2 autenticato col token MCP
 *   *    /mcp                         -> MCP Streamable HTTP (CF9/CF10)
 *   *    tutto il resto               -> REST API Hono (CF5/CF6/CF8)
 *
 * L'inizializzazione (client Prisma/D1, override storage R2, bootstrap utente)
 * è memoizzata per isolate: il binding D1/R2 è stabile e il client è
 * riutilizzabile tra le richieste.
 */

const rest = buildRestApp();

let initPromise: Promise<void> | null = null;

function ensureInitialized(env: CfEnv): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      initD1Prisma(env);
      const base = env.MCP_HTTP_BASE_URL ?? "http://localhost:3100";
      setAttachmentStorageFactory(async () => createR2AttachmentStorage({ bucket: env.ATTACHMENTS, mcpBaseUrl: base }));
      await bootstrapUserOnWorker(env);
    })().catch((err) => {
      // Consenti un nuovo tentativo alla prossima richiesta se l'init fallisce.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export default {
  async fetch(request: Request, env: CfEnv, ctx: ExecutionContext): Promise<Response> {
    await ensureInitialized(env);

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/mcp/attachments/")) {
      return handleMcpAttachmentDownload(request, env);
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return handleMcpRequest(request, env);
    }
    return rest.fetch(request, env, ctx as never);
  },
};