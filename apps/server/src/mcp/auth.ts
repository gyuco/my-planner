import { prisma } from "../lib/prisma.js";
import { getAuthUser, isAdmin } from "../services/userService.js";

/**
 * Hash del token MCP (SHA-256 via Web Crypto, nativo anche sui Workers).
 * A differenza delle password utente, un token MCP è generato random ad alta
 * entropia: non serve uno slow-hash come bcrypt per resistere al brute-force,
 * e un digest veloce permette una lookup diretta indicizzata invece di un
 * confronto lineare su tutti i token (che su Workers esauriva la CPU-time,
 * causando 1102 "Worker exceeded resource limits").
 */
export async function hashToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Valida un token MCP e restituisce il progetto a cui dà accesso.
 * Ogni token è scoped a un solo progetto (vedi prd.md sezione 3).
 */
export async function resolveProjectFromToken(rawToken: string) {
  const tokenHash = await hashToken(rawToken);
  const token = await prisma.projectToken.findFirst({ where: { tokenHash, revokedAt: null } });
  if (!token) throw new Error("Token MCP non valido o revocato");
  return token.projectId;
}

/**
 * Prefisso dei token MCP globali (per utente): li distingue a colpo d'occhio
 * dai token di progetto (64 hex senza prefisso) nei log e nelle config.
 */
export const USER_MCP_TOKEN_PREFIX = "mpu_";

function randomHex(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Crea un token MCP di progetto (64 hex, come POST /projects/:id/tokens) e
 * restituisce il valore in chiaro una sola volta; in DB resta l'hash. Web
 * Crypto: funziona sia su Node sia sui Workers.
 */
export async function createProjectToken(projectId: string, label: string | null): Promise<{ id: string; token: string }> {
  const token = randomHex();
  const created = await prisma.projectToken.create({
    data: { projectId, tokenHash: await hashToken(token), label },
  });
  return { id: created.id, token };
}

/**
 * Emette un token MCP globale per l'utente. Chiamato solo dal flusso OAuth
 * (/token, dopo il login web in /authorize): non esiste un endpoint REST che
 * lo generi, cosi' l'unico modo di ottenerlo e' autorizzarlo dal browser.
 * Il token in chiaro esce solo da qui; in DB resta l'hash.
 */
export async function issueUserMcpToken(userId: string, label?: string | null): Promise<string> {
  const rawToken = USER_MCP_TOKEN_PREFIX + randomHex();
  await prisma.userMcpToken.create({
    data: { userId, tokenHash: await hashToken(rawToken), label: label ?? null },
  });
  return rawToken;
}

/**
 * Valida un token MCP globale e restituisce l'id dell'utente. I permessi
 * (ruolo, progetti assegnati) NON sono nel token: vengono riletti a ogni
 * richiesta, quindi togliere un progetto al manager vale subito anche via MCP.
 */
export async function resolveUserFromMcpToken(rawToken: string): Promise<string> {
  if (!rawToken.startsWith(USER_MCP_TOKEN_PREFIX)) throw new Error("Token MCP globale non valido o revocato");
  const tokenHash = await hashToken(rawToken);
  const token = await prisma.userMcpToken.findFirst({ where: { tokenHash, revokedAt: null } });
  if (!token) throw new Error("Token MCP globale non valido o revocato");
  // Best effort, al massimo una scrittura l'ora: e' solo un'informazione per
  // la UI ("ultimo utilizzo"), non deve rallentare o far fallire la richiesta.
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60 * 60 * 1000) {
    await prisma.userMcpToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return token.userId;
}

/** Elenco dei connector globali dell'utente (attivi e revocati), per la UI profilo. */
export async function listUserMcpTokens(userId: string) {
  const tokens = await prisma.userMcpToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return tokens.map((t) => ({
    id: t.id,
    label: t.label,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
  }));
}

/** Revoca un token globale dell'utente; null se non esiste o non e' suo. */
export async function revokeUserMcpToken(userId: string, tokenId: string) {
  const token = await prisma.userMcpToken.findUnique({ where: { id: tokenId } });
  if (!token || token.userId !== userId) return null;
  const updated = token.revokedAt
    ? token
    : await prisma.userMcpToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  return {
    id: updated.id,
    label: updated.label,
    createdAt: updated.createdAt.toISOString(),
    lastUsedAt: updated.lastUsedAt ? updated.lastUsedAt.toISOString() : null,
    revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
  };
}

export type McpAccess = { kind: "project"; projectId: string } | { kind: "user"; userId: string };

/**
 * Risolve un token MCP di qualunque tipo (progetto o globale). Usato dove
 * entrambi sono ammessi, es. il download degli allegati (get_attachment_url).
 */
export async function resolveMcpAccess(rawToken: string): Promise<McpAccess> {
  if (rawToken.startsWith(USER_MCP_TOKEN_PREFIX)) {
    return { kind: "user", userId: await resolveUserFromMcpToken(rawToken) };
  }
  return { kind: "project", projectId: await resolveProjectFromToken(rawToken) };
}

/** true se il token (progetto o globale) puo' accedere a projectId. */
export async function mcpAccessCanReadProject(access: McpAccess, projectId: string): Promise<boolean> {
  if (access.kind === "project") return access.projectId === projectId;
  const user = await getAuthUser(access.userId);
  if (!user) return false;
  return isAdmin(user) || user.projectIds.includes(projectId);
}
