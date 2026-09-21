import type { FastifyInstance } from "fastify";
import { apiError } from "@my-planner/core";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../mcp/auth.js";
import { listProjects, createProject, renameProject, archiveProject, unarchiveProject } from "../services/taskService.js";
import { projectNameInputSchema, projectTokenInputSchema } from "../lib/validation.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", { onRequest: [app.authenticate] }, async (req) => {
    const { includeArchived } = req.query as { includeArchived?: string };
    return listProjects(includeArchived === "true");
  });

  app.post("/projects", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { name } = projectNameInputSchema.parse(req.body ?? {});
    const project = await createProject(name);
    return reply.code(201).send(project);
  });

  app.patch("/projects/:projectId", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { name } = projectNameInputSchema.parse(req.body ?? {});
    return renameProject(projectId, name);
  });

  app.post("/projects/:projectId/archive", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    return archiveProject(projectId);
  });

  app.post("/projects/:projectId/unarchive", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    return unarchiveProject(projectId);
  });

  // --- Token MCP ---------------------------------------------------------

  app.post("/projects/:projectId/tokens", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { label } = projectTokenInputSchema.parse(req.body ?? {});
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.code(404).send(apiError("NOT_FOUND", "Progetto non trovato"));

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = await hashToken(rawToken);
    const created = await prisma.projectToken.create({
      data: { projectId, tokenHash, label: label ?? null },
    });
    return reply.code(201).send({
      id: created.id,
      projectId: created.projectId,
      label: created.label,
      token: rawToken,
      createdAt: created.createdAt,
    });
  });

  app.get("/projects/:projectId/tokens", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const tokens = await prisma.projectToken.findMany({ where: { projectId } });
    return tokens.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      label: t.label,
      createdAt: t.createdAt,
      revokedAt: t.revokedAt,
    }));
  });

  app.delete("/projects/:projectId/tokens/:tokenId", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId, tokenId } = req.params as { projectId: string; tokenId: string };
    const token = await prisma.projectToken.findUnique({ where: { id: tokenId } });
    if (!token || token.projectId !== projectId) {
      return reply.code(404).send(apiError("NOT_FOUND", "Token non trovato"));
    }
    const updated = await prisma.projectToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    return { id: updated.id, revokedAt: updated.revokedAt };
  });
}
