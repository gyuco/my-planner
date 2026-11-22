import "dotenv/config";
import Fastify from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { apiError, ApiErrorException, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { createGlobalMcpServer, createProjectMcpServer } from "./server.js";
import { mcpAccessCanReadProject, resolveMcpAccess, resolveProjectFromToken, resolveUserFromMcpToken } from "./auth.js";
import { GLOBAL_MCP_PATH, handleOAuthRequest, protectedResourceMetadataUrl } from "../cf/oauth.js";
import { initNodePrisma } from "../lib/prisma.node.js";
import { prisma } from "../lib/prisma.js";
import { getAttachmentStorage } from "../lib/attachmentStorage/index.js";
import "../lib/email/index.js";

/**
 * Entry point MCP via HTTP, per uso remoto. Il token di progetto va passato
 * nell'header `Authorization: Bearer <token>`.
 *
 * /mcp/global: MCP globale (tutti i progetti dell'utente), con token utente
 * ottenuto dal login web OAuth (/authorize, stesso codice del Worker:
 * src/cf/oauth.ts, collegato qui con un bridge Request/Response).
 */
// bodyLimit più alto del default (1MB): via MCP gli allegati arrivano come
// base64 inline nel body JSON-RPC (attach_file, vedi API_CONTRACT.md §7),
// quindi il body puo' superare abbondantemente il file originale (fino a
// 50MB per i video) una volta codificato in base64 (~+33%) + overhead
// JSON-RPC. Il limite applicativo resta applicato dal service layer
// (attachmentService.validateAttachment) sul contenuto decodificato.
const app = Fastify({ logger: true, bodyLimit: 75 * 1024 * 1024 });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ApiErrorException) {
    return reply.code(HTTP_STATUS_BY_ERROR_CODE[err.code]).send(err.toApiError());
  }
  app.log.error(err);
  return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
});

/** Origine pubblica del server: MCP_HTTP_BASE_URL se impostata (dietro proxy), altrimenti dalla richiesta. */
function publicOrigin(req: any): string {
  const configured = process.env.MCP_HTTP_BASE_URL?.trim();
  if (configured) return new URL(configured).origin;
  return `${req.protocol}://${req.headers.host}`;
}

async function resolveTokenOrReject<T>(
  req: any,
  reply: any,
  resolve: (token: string) => Promise<T>,
  resourcePath = "/mcp"
): Promise<T | undefined> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  // WWW-Authenticate: i client MCP scoprono da qui il login OAuth (RFC 9728).
  reply.header("WWW-Authenticate", `Bearer resource_metadata="${protectedResourceMetadataUrl(publicOrigin(req), resourcePath)}"`);
  if (!token) {
    reply.code(401).send(apiError("MCP_TOKEN_INVALID", "Token MCP mancante"));
    return undefined;
  }
  try {
    return await resolve(token);
  } catch {
    reply.code(401).send(apiError("MCP_TOKEN_INVALID", "Token MCP non valido o revocato"));
    return undefined;
  }
}

// Il form di /authorize e il /token OAuth arrivano urlencoded: li passiamo
// grezzi al bridge (Fastify di default risponderebbe 415).
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));

async function bridgeOAuth(req: any, reply: any) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined;
  const request = new Request(`${publicOrigin(req)}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined,
  });
  const response = await handleOAuthRequest(request);
  if (!response) return reply.code(404).send(apiError("NOT_FOUND", "Not found"));
  reply.code(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));
  return reply.send(Buffer.from(await response.arrayBuffer()));
}

for (const path of ["/.well-known/*", "/authorize", "/token", "/register", "/global/*"]) {
  app.route({ method: ["GET", "POST", "OPTIONS"], url: path, handler: bridgeOAuth });
}

app.post(GLOBAL_MCP_PATH, async (req, reply) => {
  const userId = await resolveTokenOrReject(req, reply, resolveUserFromMcpToken, GLOBAL_MCP_PATH);
  if (!userId) return;

  const server = createGlobalMcpServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.raw.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

app.post("/mcp", async (req, reply) => {
  const projectId = await resolveTokenOrReject(req, reply, resolveProjectFromToken);
  if (!projectId) return;

  const server = createProjectMcpServer(projectId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.raw.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

// Download allegati via MCP (API_CONTRACT.md §7, get_attachment_url):
// stessa autenticazione a token MCP (progetto o globale), nessun JWT. Usata
// come `url` per il backend locale (per S3 si usa direttamente l'URL firmato).
app.get("/mcp/attachments/:attachmentId/download", async (req, reply) => {
  const access = await resolveTokenOrReject(req, reply, resolveMcpAccess);
  if (!access) return;

  const { attachmentId } = req.params as { attachmentId: string };
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { task: true },
  });
  if (!attachment) {
    return reply.code(404).send(apiError("NOT_FOUND", "Allegato non trovato"));
  }
  if (!(await mcpAccessCanReadProject(access, attachment.task.projectId))) {
    return reply.code(403).send(apiError("FORBIDDEN", "Il token non ha accesso a questo allegato"));
  }

  const stream = await (await getAttachmentStorage()).download(attachment.storageRef);
  reply.header("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
  reply.header("Content-Type", attachment.mimeType);
  return reply.send(stream);
});

const port = Number(process.env.MCP_HTTP_PORT ?? 3100);
initNodePrisma();
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
