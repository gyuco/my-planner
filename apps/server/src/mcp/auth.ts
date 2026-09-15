import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

/**
 * Valida un token MCP e restituisce il progetto a cui dà accesso.
 * Ogni token è scoped a un solo progetto (vedi prd.md sezione 3).
 */
export async function resolveProjectFromToken(rawToken: string) {
  const tokens = await prisma.projectToken.findMany({ where: { revokedAt: null } });
  for (const t of tokens) {
    if (await bcrypt.compare(rawToken, t.tokenHash)) {
      return t.projectId;
    }
  }
  throw new Error("Token MCP non valido o revocato");
}
