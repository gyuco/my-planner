import Fastify from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createProjectMcpServer } from "./server.js";
import { resolveProjectFromToken } from "./auth.js";

/**
 * Entry point MCP via HTTP, per uso remoto. Il token di progetto va passato
 * nell'header `Authorization: Bearer <token>`.
 */
const app = Fastify({ logger: true });

app.post("/mcp", async (req, reply) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (!token) {
    return reply.code(401).send({ error: "Token MCP mancante" });
  }
  let projectId: string;
  try {
    projectId = await resolveProjectFromToken(token);
  } catch (err) {
    return reply.code(401).send({ error: (err as Error).message });
  }

  const server = createProjectMcpServer(projectId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.raw.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

const port = Number(process.env.MCP_HTTP_PORT ?? 3100);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
