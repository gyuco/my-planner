import {
  ApiErrorException,
  type AuthUser,
  type ClaudeHookEvent,
  type ClaudeSession,
  type ClaudeSessionStatus,
  type CreatedSessionHookToken,
  type SessionHookToken,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../mcp/auth.js";
import { isAdmin, getAuthUser } from "./userService.js";

/**
 * Vista "In corso": le sessioni di Claude Code si segnalano da sole con gli
 * hook (script tools/claude-hooks/my-planner-hook.mjs) e My Planner le lega a
 * progetto e task. Non legge l'elenco sessioni di Claude: lo completa con il
 * contesto che solo My Planner ha.
 *
 * Gli hook non hanno un battito regolare: un turno lungo segnala solo
 * PostToolUse (limitato dallo script). Per questo "stale" e' calcolato alla
 * lettura e le sessioni silenziose da piu' di VISIBLE_WINDOW_MS spariscono.
 */

/** Prefisso dei token hook: distinti da quelli MCP (mpu_) e non accettati da MCP. */
export const SESSION_HOOK_TOKEN_PREFIX = "mph_";
/** Una sessione "working" senza segnali da piu' di cosi' e' probabilmente caduta. */
export const STALE_AFTER_MS = 20 * 60 * 1000;
/** Le sessioni senza segnali da piu' di cosi' non si mostrano piu'. */
export const VISIBLE_WINDOW_MS = 24 * 60 * 60 * 1000;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

const STATUS_BY_EVENT: Record<ClaudeHookEvent, ClaudeSessionStatus> = {
  SessionStart: "idle",
  UserPromptSubmit: "working",
  PostToolUse: "working",
  Notification: "waiting_input",
  Stop: "idle",
  SessionEnd: "ended",
};

/** Ordine nella vista: prima chi aspetta l'utente, poi chi lavora. */
const STATUS_ORDER: Record<ClaudeSessionStatus, number> = { waiting_input: 0, working: 1, idle: 2, ended: 3 };

// --- Token degli hook -------------------------------------------------------

function randomHex(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function serializeHookToken(t: {
  id: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): SessionHookToken {
  return {
    id: t.id,
    label: t.label,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
  };
}

/** Crea un token hook per l'utente; il token in chiaro esce solo da qui. */
export async function createSessionHookToken(userId: string, label?: string | null): Promise<CreatedSessionHookToken> {
  const token = SESSION_HOOK_TOKEN_PREFIX + randomHex();
  const created = await prisma.sessionHookToken.create({
    data: { userId, tokenHash: await hashToken(token), label: label?.trim() || null },
  });
  return { ...serializeHookToken(created), token };
}

export async function listSessionHookTokens(userId: string): Promise<SessionHookToken[]> {
  const tokens = await prisma.sessionHookToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return tokens.map(serializeHookToken);
}

/** Revoca un token hook dell'utente; NOT_FOUND se non esiste o non e' suo. */
export async function revokeSessionHookToken(userId: string, tokenId: string): Promise<SessionHookToken> {
  const token = await prisma.sessionHookToken.findUnique({ where: { id: tokenId } });
  if (!token || token.userId !== userId) throw new ApiErrorException("NOT_FOUND", "Token non trovato");
  const updated = token.revokedAt
    ? token
    : await prisma.sessionHookToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  return serializeHookToken(updated);
}

/** Valida un token hook e restituisce l'id dell'utente; null se non valido o revocato. */
export async function resolveUserFromHookToken(rawToken: string | null | undefined): Promise<string | null> {
  if (!rawToken || !rawToken.startsWith(SESSION_HOOK_TOKEN_PREFIX)) return null;
  const token = await prisma.sessionHookToken.findFirst({
    where: { tokenHash: await hashToken(rawToken), revokedAt: null },
  });
  if (!token) return null;
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await prisma.sessionHookToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return token.userId;
}

/** Estrae il token dall'header Authorization: Bearer. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}

// --- Collegamento a progetto e task ----------------------------------------

/**
 * owner/name (minuscolo) da un remote git o da un URL GitHub:
 * https://github.com/o/r.git, git@github.com:o/r.git, http://proxy/git/o/r, o/r.
 */
export function normalizeRepo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw
    .trim()
    .replace(/\.git$/i, "")
    .split(/[/:]/)
    .filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts.slice(-2);
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  return `${owner}/${name}`.toLowerCase();
}

/** Id del task dal branch, secondo lo schema feat/{taskId}-{slug} (id cuid). */
export function taskIdFromBranch(branch: string | null | undefined): string | null {
  const match = /^[\w.-]+\/(c[a-z0-9]{20,32})(?:-|$)/.exec(branch ?? "");
  return match ? match[1] : null;
}

function canSeeProject(user: AuthUser, projectId: string): boolean {
  return isAdmin(user) || user.projectIds.includes(projectId);
}

/**
 * Progetto: l'unico progetto visibile all'utente con quel repository (se piu'
 * progetti condividono il repo, decide il task del branch). Task: quello del
 * branch, se esiste ed e' visibile, nel progetto trovato.
 */
async function resolveLinks(
  user: AuthUser,
  repo: string | null,
  branch: string | null,
): Promise<{ projectId: string | null; taskId: string | null }> {
  let projectId: string | null = null;
  if (repo) {
    const candidates = await prisma.project.findMany({
      where: { archived: false, repoUrl: { not: null }, ...(isAdmin(user) ? {} : { id: { in: user.projectIds } }) },
      select: { id: true, repoUrl: true },
    });
    const matches = candidates.filter((p) => normalizeRepo(p.repoUrl) === repo);
    if (matches.length === 1) projectId = matches[0].id;
  }

  let taskId: string | null = null;
  const branchTaskId = taskIdFromBranch(branch);
  if (branchTaskId) {
    const task = await prisma.task.findUnique({ where: { id: branchTaskId }, select: { id: true, projectId: true } });
    if (task && canSeeProject(user, task.projectId) && (!projectId || projectId === task.projectId)) {
      taskId = task.id;
      projectId = task.projectId;
    }
  }
  return { projectId, taskId };
}

// --- Eventi degli hook ------------------------------------------------------

export interface ClaudeHookInput {
  event: ClaudeHookEvent;
  sessionId: string;
  origin?: "cli" | "cloud";
  url?: string | null;
  repo?: string | null;
  branch?: string | null;
  workdir?: string | null;
  message?: string | null;
}

/** Registra un evento hook; null se l'utente non esiste piu' o la sessione e' sconosciuta e gia' chiusa. */
export async function recordHookEvent(
  userId: string,
  input: ClaudeHookInput,
  now = new Date(),
): Promise<{ status: ClaudeSessionStatus } | null> {
  const user = await getAuthUser(userId);
  if (!user) return null;

  const status = STATUS_BY_EVENT[input.event];
  const repo = normalizeRepo(input.repo);
  const branch = input.branch?.trim() || null;
  const existing = await prisma.claudeSession.findUnique({
    where: { userId_sessionId: { userId, sessionId: input.sessionId } },
  });
  // Una sessione mai vista che si chiude non ha niente da mostrare.
  if (!existing && status === "ended") return null;

  const linksChanged = !existing || (repo !== null && repo !== existing.repo) || (branch !== null && branch !== existing.branch);
  const links = linksChanged ? await resolveLinks(user, repo ?? existing?.repo ?? null, branch ?? existing?.branch ?? null) : null;

  const data = {
    status,
    lastSeenAt: now,
    endedAt: status === "ended" ? now : null,
    // Il messaggio vale solo mentre la sessione aspetta l'utente.
    lastMessage: status === "waiting_input" ? input.message?.slice(0, 300) || null : null,
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
    ...(input.workdir ? { workdir: input.workdir } : {}),
    ...(links ?? {}),
  };

  if (existing) {
    // Una sessione ripresa (SessionStart dopo SessionEnd) riparte da qui.
    await prisma.claudeSession.update({
      where: { id: existing.id },
      data: input.event === "SessionStart" && existing.status === "ended" ? { ...data, startedAt: now } : data,
    });
  } else {
    await prisma.claudeSession.create({
      data: { userId, sessionId: input.sessionId, startedAt: now, origin: "cli", ...data },
    });
  }
  return { status };
}

// --- Lettura ----------------------------------------------------------------

function visibilityFilter(user: AuthUser) {
  if (isAdmin(user)) return {};
  return { OR: [{ userId: user.id }, { projectId: { in: user.projectIds } }] };
}

/**
 * Sessioni aperte visibili all'utente: le sue e quelle dei progetti che vede
 * (admin: tutte). Escluse le chiuse e quelle silenziose da piu' di 24 ore.
 */
export async function listClaudeSessions(user: AuthUser, now = new Date()): Promise<ClaudeSession[]> {
  const rows = await prisma.claudeSession.findMany({
    where: {
      status: { not: "ended" },
      lastSeenAt: { gte: new Date(now.getTime() - VISIBLE_WINDOW_MS) },
      ...visibilityFilter(user),
    },
    include: {
      project: { select: { name: true } },
      task: { select: { title: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const sessions: ClaudeSession[] = rows.map((r) => {
    const status = r.status as ClaudeSessionStatus;
    return {
      id: r.id,
      sessionId: r.sessionId,
      status,
      stale: status === "working" && now.getTime() - r.lastSeenAt.getTime() > STALE_AFTER_MS,
      origin: r.origin === "cloud" ? "cloud" : "cli",
      url: r.url,
      repo: r.repo,
      branch: r.branch,
      workdir: r.workdir,
      lastMessage: r.lastMessage,
      projectId: r.projectId,
      projectName: r.project?.name ?? null,
      taskId: r.taskId,
      taskTitle: r.task?.title ?? null,
      user: {
        id: r.user.id,
        name: `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email,
      },
      startedAt: r.startedAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    };
  });

  return sessions.sort(
    (a, b) =>
      Number(a.stale) - Number(b.stale) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
}

/**
 * Toglie dalla vista una sessione caduta (la segna chiusa). Solo chi l'ha
 * avviata o un admin; NOT_FOUND anche se non e' visibile, per non rivelarla.
 */
export async function dismissClaudeSession(user: AuthUser, id: string): Promise<{ id: string; dismissed: true }> {
  const session = await prisma.claudeSession.findFirst({ where: { id, ...visibilityFilter(user) } });
  if (!session) throw new ApiErrorException("NOT_FOUND", "Sessione non trovata");
  if (session.userId !== user.id && !isAdmin(user)) {
    throw new ApiErrorException("FORBIDDEN", "Puoi chiudere solo le tue sessioni");
  }
  await prisma.claudeSession.update({ where: { id }, data: { status: "ended", endedAt: new Date() } });
  return { id, dismissed: true };
}
