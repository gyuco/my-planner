import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { ApiErrorException } from "@my-planner/core";
import type { CfEnv } from "./env.js";
import { errorToResponse } from "./errors.js";
import { verifyAccessToken } from "./jwt.js";
import { loginUser, bootstrapUserOnWorker } from "./authService.js";
import {
  listProjects,
  createProject,
  renameProject,
  archiveProject,
  unarchiveProject,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  addDependency,
  removeDependency,
  listBlockers,
  addComment,
  listComments,
  getBoard,
  getAggregatedBoard,
} from "../services/taskService.js";
import {
  createAttachment,
  listAttachments,
  getAttachmentForDownload,
  deleteAttachment,
} from "../services/attachmentService.js";
import { getStorageSettings, updateStorageSettings } from "../services/storageSettingsService.js";
import {
  taskFiltersQuerySchema,
  taskInputSchema,
  taskUpdateInputSchema,
  moveTaskInputSchema,
  dependencyInputSchema,
  commentInputSchema,
  projectNameInputSchema,
  projectTokenInputSchema,
  boardFiltersQuerySchema,
  aggregatedBoardQuerySchema,
  storageSettingsInputSchema,
} from "../lib/validation.js";
import { prisma } from "../lib/prisma.js";
import bcrypt from "bcryptjs";

/**
 * REST API su Hono (CF3/CF5/CF8): porting 1:1 delle route Fastify
 * (src/routes/*.ts) sugli stessi service layer e schemi zod. Autenticazione
 * JWT via jose (CF6), allegati via R2 (CF7) e multipart con FormData nativa.
 */

export type AppEnv = {
  Bindings: CfEnv;
  Variables: { user: { sub: string; username: string } };
};

// Token opaco a 32 byte hex generato con Web Crypto (CF12 token MCP).
function randomTokenHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildRestApp() {
  const app = new Hono<AppEnv>();

  app.use("*", cors());

  app.onError((err, c) => {
    const { status, body } = errorToResponse(err);
    if (status >= 500) console.error(err);
    return c.json(body, status as 400);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  // --- Auth ----------------------------------------------------------------
  app.post("/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await loginUser(c.env, body));
  });

  const auth = async (c: Context<AppEnv>): Promise<Response | void> => {
    const payload = await verifyAccessToken(c.env, c.req.header("Authorization"));
    if (!payload) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Token non valido o mancante" } }, 401);
    }
    c.set("user", payload);
  };

  // Applica l'auth a tutte le route protette (tutto tranne health/login).
  const protectedPaths = [
    "/projects/*",
    "/projects",
    "/tasks/*",
    "/board",
    "/attachments/*",
    "/settings/*",
  ];
  for (const p of protectedPaths) {
    app.use(p, async (c, next) => {
      const rejected = await auth(c);
      if (rejected) return rejected;
      return next();
    });
  }

  // --- Progetti ------------------------------------------------------------
  app.get("/projects", async (c) => {
    const includeArchived = c.req.query("includeArchived") === "true";
    return c.json(await listProjects(includeArchived));
  });

  app.post("/projects", async (c) => {
    const { name } = projectNameInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createProject(name), 201);
  });

  app.patch("/projects/:projectId", async (c) => {
    const { name } = projectNameInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await renameProject(c.req.param("projectId"), name));
  });

  app.post("/projects/:projectId/archive", async (c) => c.json(await archiveProject(c.req.param("projectId"))));
  app.post("/projects/:projectId/unarchive", async (c) => c.json(await unarchiveProject(c.req.param("projectId"))));

  // --- Token MCP -----------------------------------------------------------
  app.post("/projects/:projectId/tokens", async (c) => {
    const { projectId } = c.req.param();
    const { label } = projectTokenInputSchema.parse(await c.req.json().catch(() => ({})));
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");

    const rawToken = randomTokenHex();
    const tokenHash = await bcrypt.hash(rawToken, 10);
    const created = await prisma.projectToken.create({ data: { projectId, tokenHash, label: label ?? null } });
    return c.json(
      {
        id: created.id,
        projectId: created.projectId,
        label: created.label,
        token: rawToken,
        createdAt: created.createdAt,
      },
      201
    );
  });

  app.get("/projects/:projectId/tokens", async (c) => {
    const tokens = await prisma.projectToken.findMany({ where: { projectId: c.req.param("projectId") } });
    return c.json(
      tokens.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        label: t.label,
        createdAt: t.createdAt,
        revokedAt: t.revokedAt,
      }))
    );
  });

  app.delete("/projects/:projectId/tokens/:tokenId", async (c) => {
    const { projectId, tokenId } = c.req.param();
    const token = await prisma.projectToken.findUnique({ where: { id: tokenId } });
    if (!token || token.projectId !== projectId) throw new ApiErrorException("NOT_FOUND", "Token non trovato");
    const updated = await prisma.projectToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    return c.json({ id: updated.id, revokedAt: updated.revokedAt });
  });

  // --- Task ----------------------------------------------------------------
  app.get("/projects/:projectId/tasks", async (c) => {
    const filters = taskFiltersQuerySchema.parse(c.req.query());
    return c.json(await listTasks(c.req.param("projectId"), filters));
  });

  app.post("/projects/:projectId/tasks", async (c) => {
    const body = taskInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createTask(c.req.param("projectId"), body), 201);
  });

  app.get("/tasks/:taskId", async (c) => c.json(await getTask(c.req.param("taskId"))));

  app.patch("/tasks/:taskId", async (c) => {
    const body = taskUpdateInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateTask(c.req.param("taskId"), body));
  });

  app.delete("/tasks/:taskId", async (c) => c.json(await deleteTask(c.req.param("taskId"))));

  app.post("/tasks/:taskId/move", async (c) => {
    const { status, position } = moveTaskInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await moveTask(c.req.param("taskId"), status, position));
  });

  // --- Dipendenze ----------------------------------------------------------
  app.post("/tasks/:taskId/dependencies", async (c) => {
    const { blockedByTaskId } = dependencyInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await addDependency(c.req.param("taskId"), blockedByTaskId), 201);
  });

  app.delete("/tasks/:taskId/dependencies/:blockedByTaskId", async (c) =>
    c.json(await removeDependency(c.req.param("taskId"), c.req.param("blockedByTaskId")))
  );

  app.get("/tasks/:taskId/blockers", async (c) => c.json(await listBlockers(c.req.param("taskId"))));

  // --- Commenti ------------------------------------------------------------
  app.post("/tasks/:taskId/comments", async (c) => {
    const { body } = commentInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await addComment(c.req.param("taskId"), body), 201);
  });

  app.get("/tasks/:taskId/comments", async (c) => c.json(await listComments(c.req.param("taskId"))));

  // --- Board ---------------------------------------------------------------
  app.get("/projects/:projectId/board", async (c) => {
    const filters = boardFiltersQuerySchema.parse(c.req.query());
    return c.json(await getBoard(c.req.param("projectId"), filters));
  });

  app.get("/board", async (c) => {
    const { projectIds, ...filters } = aggregatedBoardQuerySchema.parse(c.req.query());
    return c.json(await getAggregatedBoard(projectIds ? projectIds.split(",") : undefined, filters));
  });

  // --- Allegati (CF8: multipart con FormData nativa, upload su R2) ----------
  app.post("/tasks/:taskId/attachments", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) {
      throw new ApiErrorException("VALIDATION_ERROR", "Campo file 'file' mancante nel form multipart");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await createAttachment(c.req.param("taskId"), {
      fileName: file.name,
      mimeType: file.type,
      buffer,
    });
    return c.json(attachment, 201);
  });

  app.get("/tasks/:taskId/attachments", async (c) => c.json(await listAttachments(c.req.param("taskId"))));

  app.get("/attachments/:attachmentId/download", async (c) => {
    const { attachment, stream } = await getAttachmentForDownload(c.req.param("attachmentId"));
    return new Response(stream as ReadableStream, {
      headers: {
        "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
        "Content-Type": attachment.mimeType,
      },
    });
  });

  app.delete("/attachments/:attachmentId", async (c) => c.json(await deleteAttachment(c.req.param("attachmentId"))));

  // --- Settings ------------------------------------------------------------
  app.get("/settings/storage", async (c) => c.json(await getStorageSettings()));

  app.put("/settings/storage", async (c) => {
    const input = storageSettingsInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateStorageSettings(input));
  });

  return app;
}

export { bootstrapUserOnWorker };