import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { apiError } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";

const JWT_EXPIRES_IN = "30d";

/**
 * Bootstrap dell'utente unico al primo avvio del server, leggendo
 * BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD da env (vedi prd.md sezione 3 e
 * BACKLOG.md B4). Nessuna registrazione self-service: se le env mancano,
 * logga un warning chiaro e non crea utenti fittizi.
 */
export async function bootstrapUser(app: FastifyInstance) {
  const count = await prisma.user.count();
  if (count > 0) return;

  const username = process.env.BOOTSTRAP_USERNAME;
  const password = process.env.BOOTSTRAP_PASSWORD;
  if (!username || !password) {
    app.log.warn(
      "Nessun utente presente e BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD non impostate: " +
        "impossibile creare l'utente unico. Impostare le variabili d'ambiente e riavviare il server."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { username, passwordHash } });
  app.log.info(`Utente unico "${username}" creato al bootstrap.`);
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return reply.code(400).send(apiError("VALIDATION_ERROR", "username e password sono obbligatori"));
    }
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Credenziali non valide"));
    }
    const token = app.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: JWT_EXPIRES_IN });
    return { token };
  });
}
