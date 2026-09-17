import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { apiError } from "@my-planner/core";
import type { CfEnv } from "./env.js";
import { createProjectMcpServer } from "../mcp/server.js";
import { resolveProjectFromToken } from "../mcp/auth.js";
import { getAttachmentStorage } from "../lib/attachmentStorage/provider.js";
import { getAttachmentOrThrow } from "../services/attachmentService.js";
import { prisma } from "../lib/prisma.js";
import { ApiErrorException } from "@my-planner/core";

/**
 * MCP HTTP su Workers (CF9/CF10): sostituisce Fastify +
 * StreamableHTTPServerTransport Node di src/mcp/http.ts con la variante
 * Web Standard dello stesso transport ufficiale del SDK. Gli stessi 14 tool
 * (createProjectMcpServer) vengono esposti 1:1, con lo stesso envelope errore.
 *
 * Il token di progetto arriva in `Authorization: Bearer <token>` e viene
 * risolto contro D1 (mcp/auth.ts); il server è scoped al progetto del token.
 */

function tokenError(message: string): Response {
  return new Response(JSON.stringify(apiError("MCP_TOKEN_INVALID", message)), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveTokenOrReject(request: Request): Promise<string | Response> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) return tokenError("Token MCP mancante");
  try {
    return await resolveProjectFromToken(token);
  } catch {
    return tokenError("Token MCP non valido o revocato");
  }
}

/** Handler MCP Streamable HTTP (POST/GET/DELETE) per /mcp. */
export async function handleMcpRequest(request: Request, _env: CfEnv): Promise<Response> {
  const projectIdOrResponse = await resolveTokenOrReject(request);
  if (projectIdOrResponse instanceof Response) return projectIdOrResponse;

  const server = createProjectMcpServer(projectIdOrResponse);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/**
 * Download allegati via MCP (CF11, API_CONTRACT.md §7 get_attachment_url):
 * stessa autenticazione a token di progetto, stream diretto da R2.
 */
export async function handleMcpAttachmentDownload(request: Request, _env: CfEnv): Promise<Response> {
  const projectIdOrResponse = await resolveTokenOrReject(request);
  if (projectIdOrResponse instanceof Response) return projectIdOrResponse;

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/mcp\/attachments\/([^/]+)\/download$/);
  const attachmentId = match?.[1];
  if (!attachmentId) {
    return new Response(JSON.stringify(apiError("NOT_FOUND", "Allegato non trovato")), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const attachment = await getAttachmentOrThrow(attachmentId);
    const task = await prisma.task.findUnique({ where: { id: attachment.taskId } });
    if (!task || task.projectId !== projectIdOrResponse) {
      return new Response(JSON.stringify(apiError("FORBIDDEN", "L'allegato non appartiene al progetto del token")), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stream = await (await getAttachmentStorage()).download(attachment.storageRef);
    return new Response(stream as ReadableStream, {
      headers: {
        "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
        "Content-Type": attachment.mimeType,
      },
    });
  } catch (err) {
    if (err instanceof ApiErrorException && err.code === "NOT_FOUND") {
      return new Response(JSON.stringify(err.toApiError()), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw err;
  }
}