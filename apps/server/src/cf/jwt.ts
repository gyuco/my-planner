import { SignJWT, jwtVerify } from "jose";

/**
 * JWT su Workers (CF6): sostituisce @fastify/jwt con jose (Web Crypto).
 * HS256, stesso payload ({sub, username}) e stessa scadenza (30gg) di Node,
 * cosi' i token emessi dal runtime Fastify restano validi e viceversa.
 * JWT_SECRET arriva da vars/secrets wrangler (obbligatorio: nessun default).
 */

const JWT_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60; // 30 giorni

export function getJwtSecret(env: { JWT_SECRET?: string }): string {
  const secret = env.JWT_SECRET ?? "";
  if (!secret || secret.trim().length === 0) {
    throw new Error("JWT_SECRET non impostata: il Worker non puo' avviarsi (vedi wrangler.toml / secrets)");
  }
  return secret;
}

export async function signAccessToken(
  env: { JWT_SECRET?: string },
  payload: { sub: string; username: string }
): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret(env));
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN_SECONDS)
    .sign(secret);
}

/**
 * Verifica un Bearer token. Ritorna il payload decodificato oppure null
 * se il token è assente o invalido.
 */
export async function verifyAccessToken(
  env: { JWT_SECRET?: string },
  authorization: string | undefined | null
): Promise<{ sub: string; username: string } | null> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(getJwtSecret(env));
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    const username = typeof payload.username === "string" ? payload.username : "";
    return { sub: payload.sub, username };
  } catch {
    return null;
  }
}