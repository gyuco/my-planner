import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { ApiErrorException, type AuthUser } from "@my-planner/core";
import type { CfEnv } from "./env.js";
import { errorToResponse } from "./errors.js";
import { verifyAccessToken } from "./jwt.js";
import { loginUser, bootstrapUserOnWorker } from "./authService.js";
import {
  assertAdmin,
  assertAttachmentAccess,
  assertProjectAccess,
  assertTaskAccess,
  changeOwnPassword,
  createUser,
  deleteUser,
  getAuthUser,
  isAdmin,
  listProjectsForUser,
  listUsers,
  restrictProjectIds,
  updateOwnProfile,
  updateUser,
} from "../services/userService.js";
import {
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
import { getEmailSettings, sendTestEmail, updateEmailSettings } from "../services/emailSettingsService.js";
import { listNotifications, markNotificationsRead, userActor } from "../services/notificationService.js";
import { buildStandupReport, renderStandupHtml, renderStandupText } from "./standup.js";
import { sendStandupEmail } from "./email.js";
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
  emailSettingsInputSchema,
  emailTestInputSchema,
  createUserInputSchema,
  updateUserInputSchema,
  updateProfileInputSchema,
  changePasswordInputSchema,
  notificationsQuerySchema,
  markNotificationsReadInputSchema,
} from "../lib/validation.js";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../mcp/auth.js";

/**
 * REST API su Hono (CF3/CF5/CF8): porting 1:1 delle route Fastify
 * (src/routes/*.ts) sugli stessi service layer e schemi zod. Autenticazione
 * JWT via jose (CF6), allegati via R2 (CF7) e multipart con FormData nativa.
 */

export type AppEnv = {
  Bindings: CfEnv;
  Variables: { user: AuthUser };
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
    // Ruolo e progetti sono letti ad ogni richiesta: cambi di assegnazione
    // hanno effetto immediato anche sui JWT gia' emessi.
    const authUser = await getAuthUser(payload.sub);
    if (!authUser) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Utente non piu' valido" } }, 401);
    }
    c.set("user", authUser);
  };

  // Applica l'auth a tutte le route protette (tutto tranne health/login).
  // ATTENZIONE: in Hono il match e' in ordine di registrazione, quindi ogni
  // route coperta da questi middleware va registrata DOPO questo blocco —
  // altrimenti l'handler risponde prima che l'auth venga eseguita.
  const protectedPaths = [
    "/auth/me",
    "/auth/me/*",
    "/projects/*",
    "/projects",
    "/tasks/*",
    "/board",
    "/notifications",
    "/notifications/*",
    "/attachments/*",
    "/settings/*",
    "/admin/*",
    "/users",
    "/users/*",
  ];
  for (const p of protectedPaths) {
    app.use(p, async (c, next) => {
      const rejected = await auth(c);
      if (rejected) return rejected;
      return next();
    });
  }

  // Route admin-only: gestione utenti e impostazioni globali. L'auth e' gia'
  // stata applicata dal blocco sopra.
  for (const p of ["/settings/*", "/admin/*", "/users", "/users/*"]) {
    app.use(p, async (c, next) => {
      try {
        assertAdmin(c.get("user"));
      } catch (err) {
        if (err instanceof ApiErrorException) {
          return c.json(err.toApiError(), 403);
        }
        throw err;
      }
      return next();
    });
  }

  // --- Auth / utente corrente ---------------------------------------------
  app.get("/auth/me", (c) => c.json(c.get("user")));

  app.patch("/auth/me", async (c) => {
    const input = updateProfileInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateOwnProfile(c.get("user").id, input));
  });

  app.patch("/auth/me/password", async (c) => {
    const input = changePasswordInputSchema.parse(await c.req.json().catch(() => ({})));
    await changeOwnPassword(c.get("user").id, input);
    return c.json({ ok: true });
  });

  // --- Gestione utenti (admin) ---------------------------------------------
  app.get("/users", async (c) => c.json(await listUsers()));

  app.post("/users", async (c) => {
    const input = createUserInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createUser(input), 201);
  });

  app.patch("/users/:userId", async (c) => {
    const input = updateUserInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateUser(c.req.param("userId"), input, c.get("user").id));
  });

  app.delete("/users/:userId", async (c) =>
    c.json(await deleteUser(c.req.param("userId"), c.get("user").id))
  );

  // --- Admin ---------------------------------------------------------------
  // Lancia manualmente lo standup giornaliero (normalmente via Cron Trigger,
  // vedi wrangler.toml [triggers]) — utile per testare il canale email senza
  // aspettare l'orario schedulato. Protetto dall'auth: senza Bearer token
  // chiunque potrebbe far partire invii di mail a raffica.
  app.post("/admin/run-standup", async (c) => {
    const report = await buildStandupReport();
    await sendStandupEmail(
      c.env,
      `Standup my-planner — ${report.todayLabel}`,
      renderStandupText(report),
      renderStandupHtml(report)
    );
    return c.json({ status: "sent", totals: report.totals });
  });

  // --- Progetti ------------------------------------------------------------
  app.get("/projects", async (c) => {
    const includeArchived = c.req.query("includeArchived") === "true";
    return c.json(await listProjectsForUser(c.get("user"), includeArchived));
  });

  app.post("/projects", async (c) => {
    assertAdmin(c.get("user"));
    const { name } = projectNameInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createProject(name), 201);
  });

  app.patch("/projects/:projectId", async (c) => {
    await assertProjectAccess(c.get("user"), c.req.param("projectId"));
    const { name } = projectNameInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await renameProject(c.req.param("projectId"), name));
  });

  app.post("/projects/:projectId/archive", async (c) => {
    await assertProjectAccess(c.get("user"), c.req.param("projectId"));
    return c.json(await archiveProject(c.req.param("projectId")));
  });

  app.post("/projects/:projectId/unarchive", async (c) => {
    await assertProjectAccess(c.get("user"), c.req.param("projectId"));
    return c.json(await unarchiveProject(c.req.param("projectId")));
  });

  // --- Token MCP -----------------------------------------------------------
  app.post("/projects/:projectId/tokens", async (c) => {
    const { projectId } = c.req.param();
    await assertProjectAccess(c.get("user"), projectId);
    const { label } = projectTokenInputSchema.parse(await c.req.json().catch(() => ({})));
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");

    const rawToken = randomTokenHex();
    const tokenHash = await hashToken(rawToken);
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
    const { projectId } = c.req.param();
    await assertProjectAccess(c.get("user"), projectId);
    const tokens = await prisma.projectToken.findMany({ where: { projectId } });
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
    await assertProjectAccess(c.get("user"), projectId);
    const token = await prisma.projectToken.findUnique({ where: { id: tokenId } });
    if (!token || token.projectId !== projectId) throw new ApiErrorException("NOT_FOUND", "Token non trovato");
    const updated = await prisma.projectToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    return c.json({ id: updated.id, revokedAt: updated.revokedAt });
  });

  // --- Task ----------------------------------------------------------------
  app.get("/projects/:projectId/tasks", async (c) => {
    const { projectId } = c.req.param();
    await assertProjectAccess(c.get("user"), projectId);
    const filters = taskFiltersQuerySchema.parse(c.req.query());
    return c.json(await listTasks(projectId, filters));
  });

  app.post("/projects/:projectId/tasks", async (c) => {
    const { projectId } = c.req.param();
    await assertProjectAccess(c.get("user"), projectId);
    const body = taskInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await createTask(projectId, body, userActor(c.get("user"))), 201);
  });

  app.get("/tasks/:taskId", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    return c.json(await getTask(c.req.param("taskId")));
  });

  app.patch("/tasks/:taskId", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    const body = taskUpdateInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateTask(c.req.param("taskId"), body));
  });

  app.delete("/tasks/:taskId", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    return c.json(await deleteTask(c.req.param("taskId")));
  });

  app.post("/tasks/:taskId/move", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    const { status, position } = moveTaskInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await moveTask(c.req.param("taskId"), status, position, userActor(c.get("user"))));
  });

  // --- Dipendenze ----------------------------------------------------------
  app.post("/tasks/:taskId/dependencies", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    const { blockedByTaskId } = dependencyInputSchema.parse(await c.req.json().catch(() => ({})));
    await assertTaskAccess(c.get("user"), blockedByTaskId);
    return c.json(await addDependency(c.req.param("taskId"), blockedByTaskId), 201);
  });

  app.delete("/tasks/:taskId/dependencies/:blockedByTaskId", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    await assertTaskAccess(c.get("user"), c.req.param("blockedByTaskId"));
    return c.json(await removeDependency(c.req.param("taskId"), c.req.param("blockedByTaskId")));
  });

  app.get("/tasks/:taskId/blockers", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    return c.json(await listBlockers(c.req.param("taskId")));
  });

  // --- Commenti ------------------------------------------------------------
  app.post("/tasks/:taskId/comments", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    const { body } = commentInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await addComment(c.req.param("taskId"), body, userActor(c.get("user"))), 201);
  });

  app.get("/tasks/:taskId/comments", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    return c.json(await listComments(c.req.param("taskId")));
  });

  // --- Board ---------------------------------------------------------------
  app.get("/projects/:projectId/board", async (c) => {
    const { projectId } = c.req.param();
    await assertProjectAccess(c.get("user"), projectId);
    const filters = boardFiltersQuerySchema.parse(c.req.query());
    return c.json(await getBoard(projectId, filters));
  });

  app.get("/board", async (c) => {
    const user = c.get("user");
    const { projectIds, ...filters } = aggregatedBoardQuerySchema.parse(c.req.query());
    let allowed = restrictProjectIds(user, projectIds ? projectIds.split(",") : undefined);
    if (!isAdmin(user)) {
      const active = new Set((await listProjectsForUser(user, false)).map((p) => p.id));
      allowed = (allowed ?? []).filter((id) => active.has(id));
    }
    return c.json(await getAggregatedBoard(allowed, filters));
  });

  // --- Notifiche -----------------------------------------------------------
  app.get("/notifications", async (c) => {
    const { limit } = notificationsQuerySchema.parse(c.req.query());
    return c.json(await listNotifications(c.get("user"), limit ?? 30));
  });

  app.post("/notifications/read", async (c) => {
    const { upTo } = markNotificationsReadInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await markNotificationsRead(c.get("user"), upTo));
  });

  // --- Allegati (CF8: multipart con FormData nativa, upload su R2) ----------
  app.post("/tasks/:taskId/attachments", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
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

  app.get("/tasks/:taskId/attachments", async (c) => {
    await assertTaskAccess(c.get("user"), c.req.param("taskId"));
    return c.json(await listAttachments(c.req.param("taskId")));
  });

  app.get("/attachments/:attachmentId/download", async (c) => {
    await assertAttachmentAccess(c.get("user"), c.req.param("attachmentId"));
    const { attachment, stream } = await getAttachmentForDownload(c.req.param("attachmentId"));
    return new Response(stream as ReadableStream, {
      headers: {
        "Content-Disposition": `attachment; filename="${attachment.fileName}"`,
        "Content-Type": attachment.mimeType,
      },
    });
  });

  app.delete("/attachments/:attachmentId", async (c) => {
    await assertAttachmentAccess(c.get("user"), c.req.param("attachmentId"));
    return c.json(await deleteAttachment(c.req.param("attachmentId")));
  });

  // --- Settings ------------------------------------------------------------
  app.get("/settings/storage", async (c) => c.json(await getStorageSettings()));

  app.put("/settings/storage", async (c) => {
    const input = storageSettingsInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateStorageSettings(input));
  });

  app.get("/settings/email", async (c) => c.json(await getEmailSettings()));

  app.put("/settings/email", async (c) => {
    const input = emailSettingsInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await updateEmailSettings(input));
  });

  // Destinatario di default: l'admin che sta configurando.
  app.post("/settings/email/test", async (c) => {
    const input = emailTestInputSchema.parse(await c.req.json().catch(() => ({})));
    return c.json(await sendTestEmail(input.to || c.get("user").email));
  });

  return app;
}

export { bootstrapUserOnWorker };