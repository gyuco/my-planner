import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { authRoutes } from "./routes/auth.js";
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
    reply.code(401).send({ error: "Token non valido" });
  }
});

app.get("/health", async () => ({ status: "ok" }));

app.register(authRoutes);
app.register(boardRoutes);

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
