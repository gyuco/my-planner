import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { apiError } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { updateProfileInputSchema } from "../lib/validation.js";
import { getAuthUser, normalizeRole, updateOwnProfile } from "../services/userService.js";

const JWT_EXPIRES_IN = "30d";

/**
 * Bootstrap dell'utente unico al primo avvio del server, leggendo
 * BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD da env (vedi prd.md sezione 3 e
 * BACKLOG.md B4). Nessuna registrazione self-service: se le env mancano,
 * logga un warning chiaro e non crea utenti fittizi.
 *
 * Il primo utente e' sempre amministratore: da li' in poi puo' creare gli
 * altri utenti (admin o manager) dalla UI di gestione utenti.
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
  await prisma.user.create({ data: { username, passwordHash, role: "admin" } });
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
    const authUser = await getAuthUser(user.id);
    return {
      token,
      user:
        authUser ?? {
          id: user.id,
          username: user.username,
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          email: user.email ?? null,
          role: normalizeRole(user.role),
          projectIds: [],
        },
    };
  });

  // Dati aggiornati dell'utente corrente: il frontend li usa per nascondere le
  // funzioni admin e per riflettere subito eventuali cambi di ruolo/progetti.
  app.get("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    return (req as any).authUser;
  });

  // Modifica self-service dei dati del profilo (oggi solo l'email). Restituisce
  // l'AuthUser aggiornato così la UI può riusarlo senza un altro GET /auth/me.
  app.patch("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    const input = updateProfileInputSchema.parse(req.body ?? {});
    return updateOwnProfile((req as any).authUser.id, input);
  });
}