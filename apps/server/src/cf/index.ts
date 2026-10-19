import type { ExecutionContext, ScheduledEvent } from "@cloudflare/workers-types";
import { buildRestApp, bootstrapUserOnWorker } from "./rest.js";
import { withRequestPrisma } from "./db.js";
import { setAttachmentStorageFactory } from "../lib/attachmentStorage/provider.js";
import { createR2AttachmentStorage } from "./storage/r2.js";
import { handleMcpRequest, handleMcpAttachmentDownload } from "./mcp.js";
import { buildStandupReport, renderStandupHtml, renderStandupText } from "./standup.js";
import { sendStandupEmail } from "./email.js";
import type { CfEnv } from "./env.js";

/**
 * Entry point del Worker Cloudflare (CF1/CF3).
 * Routing:
 *   GET  /mcp/attachments/:id/download -> stream R2 autenticato col token MCP
 *   *    /mcp                         -> MCP Streamable HTTP (CF9/CF10)
 *   *    tutto il resto               -> REST API Hono (CF5/CF6/CF8)
 *
 * Ogni invocazione (fetch e scheduled) gira dentro `withRequestPrisma`, che le
 * assegna un client Prisma/D1 dedicato: su workerd le promise sono legate
 * all'I/O context della richiesta che le ha create, quindi client e code di
 * query NON sono condivisibili tra richieste (vedi lib/prisma.ts).
 */

const rest = buildRestApp();

// Deve restare allineato a [triggers].crons in wrangler.toml.
const STANDUP_CRON = "0 6 * * *";

// Il bootstrap dell'utente unico va fatto una volta sola per isolate, ma NON
// puo' essere memoizzato come promise condivisa: una promise creata in una
// richiesta e attesa da un'altra non si risolve mai su workerd e manda in hang
// il Worker (vedi setPrismaResolver in lib/prisma.ts). Memoizziamo quindi solo
// l'esito, con un booleano: finche' non riesce, ogni richiesta ritenta nel
// proprio I/O context.
let bootstrapDone = false;

async function prepareRequest(env: CfEnv): Promise<void> {
  // Riassegnata ad ogni richiesta per non catturare l'`env` di una precedente.
  const base = env.MCP_HTTP_BASE_URL ?? "http://localhost:3100";
  setAttachmentStorageFactory(async () => createR2AttachmentStorage({ bucket: env.ATTACHMENTS, mcpBaseUrl: base }));

  if (!bootstrapDone) {
    await bootstrapUserOnWorker(env);
    bootstrapDone = true;
  }
}

export default {
  async fetch(request: Request, env: CfEnv, ctx: ExecutionContext): Promise<Response> {
    return withRequestPrisma(env, async () => {
      await prepareRequest(env);

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.startsWith("/mcp/attachments/")) {
        return handleMcpAttachmentDownload(request, env);
      }
      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
        return handleMcpRequest(request, env);
      }
      return rest.fetch(request, env, ctx as never);
    });
  },

  // Standup giornaliero (CF: Cron Trigger, vedi wrangler.toml [triggers]).
  // Legge direttamente D1 (tutti i progetti, non scoped come un token MCP)
  // e invia il riepilogo via Gmail API.
  async scheduled(event: ScheduledEvent, env: CfEnv, ctx: ExecutionContext): Promise<void> {
    // Cloudflare può continuare a consegnare cron trigger rimossi dalla config
    // (visto in produzione: un "* * * * *" di test ha inviato una mail al minuto
    // per un'ora, sopravvivendo sia al deploy corretto sia alla cancellazione
    // via API). L'handler risponde solo allo schedule atteso.
    if (event.cron !== STANDUP_CRON) return;

    ctx.waitUntil(
      withRequestPrisma(env, async () => {
        await prepareRequest(env);
        const report = await buildStandupReport();
        await sendStandupEmail(
          env,
          `Standup my-planner — ${report.todayLabel}`,
          renderStandupText(report),
          renderStandupHtml(report)
        );
      })
    );
  },
};