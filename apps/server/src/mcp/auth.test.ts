import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { createProject } from "../services/taskService.js";
import { resolveProjectFromToken } from "./auth.js";

async function createRawTokenForProject(projectId: string, rawToken: string) {
  const tokenHash = await bcrypt.hash(rawToken, 10);
  return prisma.projectToken.create({ data: { projectId, tokenHash } });
}

describe("mcp/auth — resolveProjectFromToken", () => {
  it("risolve il projectId per un token valido", async () => {
    const project = await createProject("Progetto");
    await createRawTokenForProject(project.id, "token-valido");

    const resolved = await resolveProjectFromToken("token-valido");
    expect(resolved).toBe(project.id);
  });

  it("rifiuta un token invalido/inesistente", async () => {
    const project = await createProject("Progetto");
    await createRawTokenForProject(project.id, "token-valido");

    await expect(resolveProjectFromToken("token-sbagliato")).rejects.toThrow(
      "Token MCP non valido o revocato"
    );
  });

  it("rifiuta un token revocato", async () => {
    const project = await createProject("Progetto");
    const record = await createRawTokenForProject(project.id, "token-da-revocare");
    await prisma.projectToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });

    await expect(resolveProjectFromToken("token-da-revocare")).rejects.toThrow(
      "Token MCP non valido o revocato"
    );
  });
});
