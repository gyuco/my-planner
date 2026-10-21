import type {
  AuthUser,
  MarkNotificationsReadResponse,
  NotificationItem,
  NotificationsResponse,
  TaskEventType,
  TaskFieldChange,
  TaskStatus,
} from "@my-planner/core";
import { NOTIFICATION_EVENT_TYPES } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";

/**
 * Notifiche locali basate su un event log append-only.
 *
 * Scelte di fondo (vedi BACKLOG/nota di design):
 *  - nessun fan-out: una riga per azione, con al massimo un destinatario
 *    (`recipientId` = l'assegnatario del task, deciso in scrittura);
 *  - `id` autoincrementale = cursore di lettura per utente
 *    (`NotificationState.lastSeenEventId`);
 *  - i permessi di progetto sono applicati in lettura, cosi' rimuovere un
 *    manager da un progetto gli toglie anche le notifiche relative.
 *
 * Gli eventi vengono scritti dal service layer (taskService), quindi coprono
 * automaticamente REST Node, REST Cloudflare e MCP.
 *
 * La stessa tabella fa anche da log attivita' (vedi activityService.ts): le
 * notifiche considerano solo i tipi in `NOTIFICATION_EVENT_TYPES`.
 */

export type Actor =
  | { type: "user"; id: string }
  | { type: "mcp" }
  | { type: "system" };

/** Attore usato dai test e dalle operazioni interne senza utente. */
export const SYSTEM_ACTOR: Actor = { type: "system" };

/** Attore per le richieste autenticate REST (Node e Cloudflare). */
export function userActor(user: AuthUser): Actor {
  return { type: "user", id: user.id };
}

export interface TaskEventData {
  /** Denormalizzato: la notifica resta leggibile dopo la delete del task. */
  title: string;
  parentId?: string | null;
  from?: TaskStatus;
  to?: TaskStatus;
  /** Estratto del commento (markdown troncato). */
  excerpt?: string;
  /** Campi modificati (`task.updated`). */
  changes?: TaskFieldChange[];
  /** Task che blocca (`dependency.*`), titolo denormalizzato. */
  relatedTaskId?: string;
  relatedTaskTitle?: string;
  /** Nome file (`attachment.*`). */
  fileName?: string;
  /** Nuovo assegnatario (`task.assigned`), null se rimosso. */
  assigneeName?: string | null;
}

export interface RecordTaskEventInput {
  projectId: string;
  taskId: string | null;
  type: TaskEventType;
  actor: Actor;
  /** Utente da notificare (in-app + email); omesso/null = nessuno. */
  recipientId?: string | null;
  data: TaskEventData;
}

/**
 * Scrive un evento. Non va chiamato direttamente dalle route: la mutazione
 * principale e l'evento devono restare vicini (vedi `emitEvent` in
 * activityService, che non fa fallire l'azione se l'evento non viene scritto).
 */
export async function recordTaskEvent(input: RecordTaskEventInput) {
  return prisma.taskEvent.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId,
      type: input.type,
      actorId: input.actor.type === "user" ? input.actor.id : null,
      actorType: input.actor.type,
      recipientId: input.recipientId ?? null,
      data: JSON.stringify(input.data),
    },
  });
}

/**
 * Filtro di visibilita' condiviso da lista, conteggio e mark-as-read:
 *  - solo gli eventi destinati all'utente (`recipientId`, mai le sue azioni:
 *    il destinatario viene scelto escludendo l'autore);
 *  - solo i tipi che generano notifica (il resto e' solo log attivita');
 *  - eventi di progetti accessibili (admin: tutti, manager: assegnati);
 *  - niente progetti archiviati.
 */
function visibilityFilter(user: AuthUser): Record<string, unknown> {
  const where: Record<string, unknown> = {
    recipientId: user.id,
    type: { in: [...NOTIFICATION_EVENT_TYPES] },
    project: { archived: false },
  };
  if (user.role !== "admin") where.projectId = { in: user.projectIds };
  return where;
}

/**
 * Cursore dell'utente. Alla prima lettura viene inizializzato al max id
 * corrente, cosi' un utente "storico" non si vede arrivare tutto il backlog.
 * Per gli utenti nuovi l'ancoraggio vero e' alla creazione dell'account
 * (vedi `initNotificationStateForUser` chiamata da userService.createUser).
 */
async function getOrInitState(userId: string) {
  const existing = await prisma.notificationState.findUnique({ where: { userId } });
  if (existing) return existing;

  await initNotificationStateForUser(userId);
  const created = await prisma.notificationState.findUnique({ where: { userId } });
  if (!created) throw new Error("Impossibile inizializzare il cursore delle notifiche");
  return created;
}

/**
 * Ancora il cursore di un utente appena creato all'ultimo evento esistente:
 * non deve vedere gli eventi precedenti al suo account. Idempotente (upsert
 * con update vuoto): se lo stato esiste gia' non lo tocca.
 */
export async function initNotificationStateForUser(userId: string): Promise<void> {
  const max = await prisma.taskEvent.aggregate({ _max: { id: true } });
  await prisma.notificationState.upsert({
    where: { userId },
    update: {},
    create: { userId, lastSeenEventId: max._max.id ?? 0 },
  });
}

export function parseEventData(raw: string): TaskEventData {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as TaskEventData) : { title: "" };
  } catch {
    return { title: "" };
  }
}

export function serializeEvent(row: any): NotificationItem {
  const data = parseEventData(row.data);
  const actorName = row.actor
    ? [row.actor.firstName, row.actor.lastName].filter(Boolean).join(" ") || row.actor.email
    : null;

  return {
    id: row.id,
    type: row.type as TaskEventType,
    projectId: row.projectId,
    projectName: row.project?.name ?? "",
    taskId: row.taskId ?? null,
    taskTitle: data.title || "(task)",
    actorId: row.actorId ?? null,
    actorName,
    actorType: row.actorType as NotificationItem["actorType"],
    from: data.from ?? null,
    to: data.to ?? null,
    excerpt: data.excerpt ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listNotifications(
  user: AuthUser,
  limit = 30,
): Promise<NotificationsResponse> {
  const state = await getOrInitState(user.id);
  const scope = visibilityFilter(user);
  const unreadWhere = { ...scope, id: { gt: state.lastSeenEventId } };

  const [rows, unreadCount, maxRow] = await Promise.all([
    prisma.taskEvent.findMany({
      where: unreadWhere,
      include: {
        project: { select: { name: true } },
        actor: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { id: "desc" },
      take: limit,
    }),
    prisma.taskEvent.count({ where: unreadWhere }),
    prisma.taskEvent.aggregate({ where: scope, _max: { id: true } }),
  ]);

  return {
    items: rows.map(serializeEvent),
    unreadCount,
    lastSeenEventId: state.lastSeenEventId,
    serverCursor: maxRow._max.id ?? state.lastSeenEventId,
  };
}

/**
 * Sposta il cursore a `upTo`, senza mai superare l'ultimo evento visibile
 * all'utente (evita di "leggere in anticipo" eventi non ancora restituiti).
 */
export async function markNotificationsRead(
  user: AuthUser,
  upTo: number,
): Promise<MarkNotificationsReadResponse> {
  const state = await getOrInitState(user.id);
  const maxRow = await prisma.taskEvent.aggregate({
    where: visibilityFilter(user),
    _max: { id: true },
  });
  const cursor = Math.min(upTo, maxRow._max.id ?? 0);

  if (cursor <= state.lastSeenEventId) {
    return { lastSeenEventId: state.lastSeenEventId };
  }

  const updated = await prisma.notificationState.update({
    where: { userId: user.id },
    data: { lastSeenEventId: cursor },
  });
  return { lastSeenEventId: updated.lastSeenEventId };
}
