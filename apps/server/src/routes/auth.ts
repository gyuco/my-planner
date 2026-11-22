import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { apiError } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { listUserMcpTokens, revokeUserMcpToken } from "../mcp/auth.js";
import { avatarInputSchema, changePasswordInputSchema, updateProfileInputSchema } from "../lib/validation.js";
import {
  changeOwnPassword,
  getAuthUser,
  getOwnAvatar,
  getUserAvatar,
  normalizeRole,
  setOwnAvatar,
  updateOwnProfile,
} from "../services/userService.js";

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
          avatarVersion: null,
        },
    };
  });

  // Dati aggiornati dell'utente corrente: il frontend li usa per nascondere le
  // funzioni admin e per riflettere subito eventuali cambi di ruolo/progetti.
  app.get("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    return (req as any).authUser;
  });

  // Modifica self-service dei dati del profilo (nome, cognome, email).
  // Restituisce l'AuthUser aggiornato così la UI può riusarlo senza un altro GET /auth/me.
  app.patch("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    const input = updateProfileInputSchema.parse(req.body ?? {});
    return updateOwnProfile((req as any).authUser.id, input);
  });

  // Cambio password self-service: richiede la password attuale come conferma.
  app.patch("/auth/me/password", { onRequest: [app.authenticate] }, async (req) => {
    const input = changePasswordInputSchema.parse(req.body ?? {});
    await changeOwnPassword((req as any).authUser.id, input);
    return { ok: true };
  });

  // Avatar self-service: data URL gia' ridimensionato dal client. Lettura su
  // endpoint dedicato (autenticato) per non appesantire /auth/me.
  app.get("/auth/me/avatar", { onRequest: [app.authenticate] }, async (req) => {
    return getOwnAvatar((req as any).authUser.id);
  });

  app.put("/auth/me/avatar", { onRequest: [app.authenticate] }, async (req) => {
    const input = avatarInputSchema.parse(req.body ?? {});
    return setOwnAvatar((req as any).authUser.id, input.dataUrl);
  });

  app.delete("/auth/me/avatar", { onRequest: [app.authenticate] }, async (req) => {
    return setOwnAvatar((req as any).authUser.id, null);
  });

  // Connector MCP globali dell'utente (/mcp/global). Si creano solo col login
  // web OAuth (/authorize); da qui si possono solo elencare e revocare.
  app.get("/auth/me/mcp-tokens", { onRequest: [app.authenticate] }, async (req) => {
    return listUserMcpTokens((req as any).authUser.id);
  });

  app.delete("/auth/me/mcp-tokens/:tokenId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { tokenId } = req.params as { tokenId: string };
    const revoked = await revokeUserMcpToken((req as any).authUser.id, tokenId);
    if (!revoked) return reply.code(404).send(apiError("NOT_FOUND", "Token non trovato"));
    return revoked;
  });

  // Avatar di un utente visibile (assegnatari sulle card).
  app.get("/avatars/:userId", { onRequest: [app.authenticate] }, async (req) => {
    const { userId } = req.params as { userId: string };
    return getUserAvatar((req as any).authUser, userId);
  });
}