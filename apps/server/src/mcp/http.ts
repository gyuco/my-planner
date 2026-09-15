import "dotenv/config";
import Fastify from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { apiError, ApiErrorException, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { createProjectMcpServer } from "./server.js";
import { resolveProjectFromToken } from "./auth.js";
import { prisma } from "../lib/prisma.js";
import { getAttachmentStorage } from "../lib/attachmentStorage/index.js";

/**
 * Entry point MCP via HTTP, per uso remoto. Il token di progetto va passato
 * nell'header `Authorization: Bearer <token>`.
 */
// bodyLimit più alto del default (1MB): via MCP gli allegati arrivano come
// base64 inline nel body JSON-RPC (attach_file, vedi API_CONTRACT.md §7),
// quindi il body puo' superare abbondantemente i 20MB del file originale
// una volta codificato in base64 (~+33%) + overhead JSON-RPC. Il limite
// applicativo dei 20MB resta comunque applicato dal service layer
// (attachmentService.validateAttachment) sul contenuto decodificato.
const app = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ApiErrorException) {
    return reply.code(HTTP_STATUS_BY_ERROR_CODE[err.code]).send(err.toApiError());
  }
  app.log.error(err);
  return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
});

async function resolveTokenOrReject(req: any, reply: any): Promise<string | undefined> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) {
    reply.code(401).send(apiError("MCP_TOKEN_INVALID", "Token MCP mancante"));
    return undefined;
  }
  try {
    return await resolveProjectFromToken(token);
  } catch {
    reply.code(401).send(apiError("MCP_TOKEN_INVALID", "Token MCP non valido o revocato"));
    return undefined;
  }
}

app.post("/mcp", async (req, reply) => {
  const projectId = await resolveTokenOrReject(req, reply);
  if (!projectId) return;

  const server = createProjectMcpServer(projectId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.raw.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

// Download allegati via MCP (API_CONTRACT.md §7, get_attachment_url):
// stessa autenticazione a token di progetto, nessun JWT. Usata come `url`
// per il backend locale (per S3 si usa direttamente l'URL firmato).
app.get("/mcp/attachments/:attachmentId/download", async (req, reply) => {
  const projectId = await resolveTokenOrReject(req, reply);
  if (!projectId) return;

  const { attachmentId } = req.params as { attachmentId: string };
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { task: true },
  });
  if (!attachment) {
    return reply.code(404).send(apiError("NOT_FOUND", "Allegato non trovato"));
  }
  if (attachment.task.projectId !== projectId) {
    return reply.code(403).send(apiError("FORBIDDEN", "L'allegato non appartiene al progetto del token"));
  }

  const stream = await getAttachmentStorage().download(attachment.storageRef);
  reply.header("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
  reply.header("Content-Type", attachment.mimeType);
  return reply.send(stream);
});

const port = Number(process.env.MCP_HTTP_PORT ?? 3100);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
