import { prisma } from "../lib/prisma.js";

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
