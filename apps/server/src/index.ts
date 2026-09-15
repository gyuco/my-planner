import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { authRoutes, bootstrapUser } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import { boardRoutes } from "./routes/board.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>;
  }
}

const app = Fastify({ logger: true });

app.register(jwt, { secret: process.env.JWT_SECRET ?? "dev-secret-change-me" });

app.decorate("authenticate", async function (req: any, reply: any) {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send(apiError("UNAUTHORIZED", "Token non valido o mancante"));
  }
});

// Error handler globale: mappa le ApiErrorException del service layer
// nell'envelope condiviso REST/MCP (vedi API_CONTRACT.md §1).
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ApiErrorException) {
    const status = HTTP_STATUS_BY_ERROR_CODE[err.code];
    return reply.code(status).send(err.toApiError());
  }
  app.log.error(err);
  return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
});

app.get("/health", async () => ({ status: "ok" }));

app.register(authRoutes);
app.register(projectRoutes);
app.register(taskRoutes);
app.register(boardRoutes);

const port = Number(process.env.PORT ?? 3000);

async function start() {
  await bootstrapUser(app);
  await app.listen({ port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
