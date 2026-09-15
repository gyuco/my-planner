import "dotenv/config";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { authRoutes, bootstrapUser } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import { boardRoutes } from "./routes/board.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { MAX_ATTACHMENT_SIZE_BYTES } from "./services/attachmentService.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>;
  }
}

// JWT_SECRET e' obbligatorio: nessun fallback insicuro. Se manca, il server
// deve rifiutarsi di avviarsi invece di partire con un segreto pubblico e
// prevedibile che permetterebbe di forgiare JWT validi.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length === 0) {
  // eslint-disable-next-line no-console
  console.error(
    "[my-planner] Errore fatale: la variabile d'ambiente JWT_SECRET non e' impostata. " +
      "Il server non puo' avviarsi senza un JWT_SECRET esplicito (vedi apps/server/config.example.md)."
  );
  process.exit(1);
}

const app = Fastify({ logger: true });

app.register(jwt, { secret: process.env.JWT_SECRET });

// Limite fastify-multipart volutamente più alto del limite applicativo
// (MAX_ATTACHMENT_SIZE_BYTES, 20MB) cosi' che sia il service layer
// (attachmentService.validateAttachment) a restituire l'errore tipizzato
// ATTACHMENT_TOO_LARGE, condiviso con MCP, invece di un errore generico
// di fastify-multipart.
app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES + 1024 * 1024 } });

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
  if (err instanceof ZodError) {
    const message = err.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return reply.code(400).send(apiError("VALIDATION_ERROR", message || "Input non valido"));
  }
  app.log.error(err);
  return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
});

app.get("/health", async () => ({ status: "ok" }));

app.register(authRoutes);
app.register(projectRoutes);
app.register(taskRoutes);
app.register(boardRoutes);
app.register(attachmentRoutes);

const port = Number(process.env.PORT ?? 3000);

async function start() {
  await bootstrapUser(app);
  await app.listen({ port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
