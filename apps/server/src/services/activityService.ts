import type {
  ActivityActor,
  ActivityLogItem,
  ActivityLogResponse,
  AuthUser,
  TaskEventType,
} from "@my-planner/core";
import { NOTIFICATION_EVENT_TYPES } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import {
  parseEventData,
  recordTaskEvent,
  serializeEvent,
  type RecordTaskEventInput,
} from "./notificationService.js";
import { queueTaskEventEmail } from "./emailNotificationService.js";

/**
 * Log attivita': ogni mutazione rilevante di un task scrive una riga in
 * TaskEvent (stessa tabella delle notifiche). Le notifiche in-app e le email
 * considerano solo `NOTIFICATION_EVENT_TYPES`; il log li espone tutti, con
 * filtri, incluse le azioni dell'utente corrente.
 *
 * Il "tempo reale" lato client e' un polling con `afterId` (stesso motivo
 * delle notifiche: niente SSE/WebSocket su Workers/D1 senza Durable Objects).
 */

const NOTIFIABLE = new Set<TaskEventType>(NOTIFICATION_EVENT_TYPES);

/**
 * Scrive l'evento senza far fallire l'azione principale: un problema sul log
 * non deve impedire di creare/spostare un task o commentare. Gli eventi sono
 * best-effort per definizione (non sono dati di dominio). Stesso discorso per
 * l'email: parte solo per i tipi notificabili, senza config SMTP non parte
 * nulla, e l'invio gira in background.
 */
export async function emitEvent(input: RecordTaskEventInput): Promise<void> {
  try {
    await recordTaskEvent(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[my-planner] impossibile registrare l'evento di attivita'", err);
  }
  if (!NOTIFIABLE.has(input.type)) return;
  try {
    await queueTaskEventEmail(input);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[my-planner] impossibile accodare l'email di notifica", err);
  }
}

export interface ActivityFilters {
  projectId?: string;
  taskId?: string;
  types?: TaskEventType[];
  actorId?: string;
  actorType?: "user" | "mcp" | "system";
  /** Estremi inclusivi su createdAt. */
  from?: Date;
  to?: Date;
  /** Testo libero su titolo task / estratto / nome file (dati denormalizzati). */
  search?: string;
  /** Solo eventi con id > afterId (polling dei nuovi). */
  afterId?: number;
  /** Solo eventi con id < beforeId (pagina successiva, piu' vecchi). */
  beforeId?: number;
  limit?: number;
}

/**
 * Query REST gia' validata (activityQuerySchema) -> filtri del service.
 * Condivisa tra Fastify e Hono: `actor` distingue utenti e attori senza id.
 */
export function activityFiltersFromQuery(query: {
  actor?: string;
} & Omit<ActivityFilters, "actorId" | "actorType">): ActivityFilters {
  const { actor, ...rest } = query;
  if (actor === "mcp" || actor === "system") return { ...rest, actorType: actor };
  if (actor) return { ...rest, actorId: actor };
  return rest;
}

function toLogItem(row: any): ActivityLogItem {
  const data = parseEventData(row.data);
  return {
    ...serializeEvent(row),
    changes: Array.isArray(data.changes) ? data.changes : [],
    relatedTaskId: data.relatedTaskId ?? null,
    relatedTaskTitle: data.relatedTaskTitle ?? null,
    fileName: data.fileName ?? null,
  };
}

/**
 * Eventi visibili all'utente: admin tutti i progetti, manager solo quelli
 * assegnati (archiviati inclusi: il log e' storico). Il filtro per task non
 * passa da assertTaskAccess perche' gli eventi sopravvivono alla delete del
 * task: lo scoping per progetto basta.
 */
export async function listActivity(user: AuthUser, filters: ActivityFilters = {}): Promise<ActivityLogResponse> {
  const limit = filters.limit ?? 50;
  const where: Record<string, unknown> = {};

  if (user.role !== "admin") {
    const allowed = filters.projectId
      ? user.projectIds.filter((id) => id === filters.projectId)
      : user.projectIds;
    where.projectId = { in: allowed };
  } else if (filters.projectId) {
    where.projectId = filters.projectId;
  }

  if (filters.taskId) where.taskId = filters.taskId;
  if (filters.types && filters.types.length > 0) where.type = { in: filters.types };
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.actorType) where.actorType = filters.actorType;
  if (filters.search) where.data = { contains: filters.search };

  const createdAt: Record<string, Date> = {};
  if (filters.from) createdAt.gte = filters.from;
  if (filters.to) createdAt.lte = filters.to;
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

  const id: Record<string, number> = {};
  if (filters.afterId !== undefined) id.gt = filters.afterId;
  if (filters.beforeId !== undefined) id.lt = filters.beforeId;
  if (Object.keys(id).length > 0) where.id = id;

  const rows = await prisma.taskEvent.findMany({
    where,
    include: {
      project: { select: { name: true } },
      actor: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { id: "desc" },
    take: limit + 1,
  });

  return {
    items: rows.slice(0, limit).map(toLogItem),
    hasMore: rows.length > limit,
  };
}

/**
 * Possibili autori per il filtro del log: admin vede tutti gli utenti, un
 * manager gli admin e i manager che condividono almeno un suo progetto.
 * Calcolato sugli utenti (pochi) invece che con un DISTINCT sul log (grande).
 */
export async function listActivityActors(user: AuthUser): Promise<ActivityActor[]> {
  const users = await prisma.user.findMany({
    where:
      user.role === "admin"
        ? {}
        : { OR: [{ role: "admin" }, { projects: { some: { projectId: { in: user.projectIds } } } }] },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: { email: "asc" },
  });
  return users.map((u) => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
  }));
}
