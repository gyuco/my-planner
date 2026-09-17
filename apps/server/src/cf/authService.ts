import bcrypt from "bcryptjs";
import { ApiErrorException } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import type { CfEnv } from "./env.js";
import { signAccessToken } from "./jwt.js";

/**
 * Bootstrap utente unico + login su Workers (CF6). Stessa logica di
 * routes/auth.ts (Node): nessuna registrazione, utente creato al bootstrap
 * da BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD (vars/secrets wrangler).
 */

export async function bootstrapUserOnWorker(env: CfEnv) {
  const count = await prisma.user.count();
  if (count > 0) return;

  const username = env.BOOTSTRAP_USERNAME;
  const password = env.BOOTSTRAP_PASSWORD;
  if (!username || !password) {
    console.warn(
      "Nessun utente presente e BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD non impostate: " +
        "impossibile creare l'utente unico (vedi secrets wrangler)."
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { username, passwordHash } });
  console.info(`Utente unico "${username}" creato al bootstrap.`);
}

export async function loginUser(env: CfEnv, body: unknown) {
  const { username, password } = (body ?? {}) as { username?: string; password?: string };
  if (!username || !password) {
    throw new ApiErrorException("VALIDATION_ERROR", "username e password sono obbligatori");
  }
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiErrorException("UNAUTHORIZED", "Credenziali non valide");
  }
  const token = await signAccessToken(env, { sub: user.id, username: user.username });
  return { token };
}