import type { FastifyInstance } from "fastify";
import {
  clearRoutineConfig,
  dispatchProject,
  getRoutineConfig,
  setRoutineConfig,
  startInteractiveSession,
} from "../services/aiRoutineService.js";
import { apiError } from "@my-planner/core";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../mcp/auth.js";
import { createProject, renameProject, updateProject, archiveProject, unarchiveProject } from "../services/taskService.js";
import { assertAdmin, assertProjectAccess, listProjectsForUser } from "../services/userService.js";
import { aiRoutineInputSchema, aiRoutineSessionInputSchema, projectNameInputSchema, projectUpdateInputSchema, projectStatusInputSchema, projectTokenInputSchema } from "../lib/validation.js";
import {
  createProjectStatus,
  deleteProjectStatus,
  listProjectStatuses,
  renameProjectStatus,
} from "../services/statusService.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", { onRequest: [app.authenticate] }, async (req) => {
    const { includeArchived } = req.query as { includeArchived?: string };
    return listProjectsForUser((req as any).authUser, includeArchived === "true");
  });

  // La creazione di progetti e' globale: riservata agli admin, che poi li
  // assegnano ai manager dalla gestione utenti.
  app.post("/projects", { onRequest: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { name } = projectNameInputSchema.parse(req.body ?? {});
    const project = await createProject(name);
    return reply.code(201).send(project);
  });

  app.patch("/projects/:projectId", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return updateProject(projectId, projectUpdateInputSchema.parse(req.body ?? {}));
  });

  app.post("/projects/:projectId/archive", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return archiveProject(projectId);
  });

  app.post("/projects/:projectId/unarchive", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return unarchiveProject(projectId);
  });

  // --- Stati personalizzati ----------------------------------------------

  app.get("/projects/:projectId/statuses", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return listProjectStatuses(projectId);
  });

  app.post("/projects/:projectId/statuses", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    const { label } = projectStatusInputSchema.parse(req.body ?? {});
    return reply.code(201).send(await createProjectStatus(projectId, label));
  });

  app.patch("/projects/:projectId/statuses/:key", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId, key } = req.params as { projectId: string; key: string };
    await assertProjectAccess((req as any).authUser, projectId);
    const { label } = projectStatusInputSchema.parse(req.body ?? {});
    return renameProjectStatus(projectId, key, label);
  });

  app.delete("/projects/:projectId/statuses/:key", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId, key } = req.params as { projectId: string; key: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return deleteProjectStatus(projectId, key);
  });

  // --- Token MCP ---------------------------------------------------------

  app.post("/projects/:projectId/tokens", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
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
    await assertProjectAccess((req as any).authUser, projectId);
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
    await assertProjectAccess((req as any).authUser, projectId);
    const token = await prisma.projectToken.findUnique({ where: { id: tokenId } });
    if (!token || token.projectId !== projectId) {
      return reply.code(404).send(apiError("NOT_FOUND", "Token non trovato"));
    }
    const updated = await prisma.projectToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    return { id: updated.id, revokedAt: updated.revokedAt };
  });

  // Routine Claude Code per l'avvio automatico dei passi AI (solo admin).
  app.get("/projects/:projectId/ai-routine", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    assertAdmin((req as any).authUser);
    return getRoutineConfig(projectId);
  });

  app.put("/projects/:projectId/ai-routine", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    assertAdmin((req as any).authUser);
    return setRoutineConfig(projectId, aiRoutineInputSchema.parse(req.body ?? {}));
  });

  app.delete("/projects/:projectId/ai-routine", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    assertAdmin((req as any).authUser);
    return clearRoutineConfig(projectId);
  });

  app.post("/projects/:projectId/ai-routine/run", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    assertAdmin((req as any).authUser);
    return dispatchProject(projectId, { force: true });
  });

  // Sessione interattiva di Claude Code (la conversazione prosegue su claude.ai).
  app.post("/projects/:projectId/ai-routine/session", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    assertAdmin((req as any).authUser);
    return startInteractiveSession(projectId, aiRoutineSessionInputSchema.parse(req.body ?? {}));
  });
}
