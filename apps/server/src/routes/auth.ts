import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { apiError } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { updateProfileInputSchema } from "../lib/validation.js";
import { getAuthUser, normalizeRole, updateOwnProfile } from "../services/userService.js";

const JWT_EXPIRES_IN = "30d";

/**
 * Bootstrap dell'utente unico al primo avvio del server, leggendo
 * BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD da env (vedi prd.md sezione 3 e
 * BACKLOG.md B4). Nessuna registrazione self-service: se le env mancano,
 * logga un warning chiaro e non crea utenti fittizi.
 *
 * Il primo utente e' sempre amministratore: da li' in poi puo' creare gli
 * altri utenti (admin o manager) dalla UI di gestione utenti.
 */
export async function bootstrapUser(app: FastifyInstance) {
  const count = await prisma.user.count();
  if (count > 0) return;

  const email = process.env.BOOTSTRAP_EMAIL;
  const password = process.env.BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    app.log.warn(
      "Nessun utente presente e BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD non impostate: " +
        "impossibile creare l'utente unico. Impostare le variabili d'ambiente e riavviare il server."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email: email.trim().toLowerCase(), passwordHash, role: "admin" } });
  app.log.info(`Utente unico "${email}" creato al bootstrap.`);
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) {
      return reply.code(400).send(apiError("VALIDATION_ERROR", "email e password sono obbligatori"));
    }
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Credenziali non valide"));
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: JWT_EXPIRES_IN });
    const authUser = await getAuthUser(user.id);
    return {
      token,
      user:
        authUser ?? {
          id: user.id,
          email: user.email,
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
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