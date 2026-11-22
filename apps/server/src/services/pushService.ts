import {
  ApiErrorException,
  normalizeAiSteps,
  type AiStep,
  type TaskStatus,
  type TaskStatusKey,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";
import { runInBackground } from "../lib/email/provider.js";
import { generateVapidKeys, isAllowedPushEndpoint, sendWebPush, type VapidKeys } from "../lib/webpush.js";
import type { RecordTaskEventInput } from "./notificationService.js";

/**
 * Notifiche push (Web Push) verso i dispositivi registrati dagli utenti.
 *
 * Chi riceve cosa:
 *  - il destinatario della notifica in-app (`recipientId`: l'assegnatario,
 *    mai l'autore dell'azione), per gli stessi eventi della campanella;
 *  - per i task con gestione AI, l'admin che la segue (`aiWatcherId`), sui
 *    cambi di stato: a ogni cambio (`notify = each`) oppure solo quando il
 *    task arriva alla colonna finale dell'ultimo passo scelto (`end`).
 *    Mai per le sue stesse azioni; una sola push se e' anche l'assegnatario.
 *
 * Mai bloccante: l'invio gira in background (come le email) e senza
 * dispositivi registrati non parte nulla.
 */

export const PUSH_LOCALES = ["it", "en", "es"] as const;
export type PushLocale = (typeof PUSH_LOCALES)[number];

export interface PushMessage {
  title: string;
  body: string;
  /** Percorso relativo all'app (es. /projects/:id?task=:id): il service worker lo apre. */
  url: string;
  /** Notifiche con lo stesso tag si sostituiscono (una per task). */
  tag: string;
}

const MAX_LABEL = 100;

// --- Chiavi VAPID -----------------------------------------------------------

async function vapidSubject(): Promise<string> {
  const admin = await prisma.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return `mailto:${admin?.email ?? "admin@example.com"}`;
}

/** Chiavi VAPID dell'app, generate e salvate (privata cifrata) al primo uso. */
export async function getVapidKeys(): Promise<VapidKeys> {
  let row = await prisma.pushSettings.findUnique({ where: { id: "default" } });
  if (!row) {
    const generated = await generateVapidKeys();
    try {
      row = await prisma.pushSettings.create({
        data: {
          id: "default",
          publicKey: generated.publicKey,
          privateKeyEncrypted: await encryptSecret(JSON.stringify(generated.privateKeyJwk)),
        },
      });
    } catch {
      // Due richieste concorrenti al primo uso: vince la prima, l'altra la rilegge.
      row = await prisma.pushSettings.findUnique({ where: { id: "default" } });
      if (!row) throw new Error("Impossibile inizializzare le chiavi VAPID");
    }
  }
  return {
    publicKey: row.publicKey,
    privateKeyJwk: JSON.parse(await decryptSecret(row.privateKeyEncrypted)),
    subject: await vapidSubject(),
  };
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

// --- Dispositivi --------------------------------------------------------------

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale?: string;
  label?: string | null;
}

function serializeDevice(row: { id: string; label: string | null; locale: string; createdAt: Date; lastSuccessAt: Date | null; endpoint: string }) {
  return {
    id: row.id,
    label: row.label,
    locale: row.locale,
    // Solo l'host: basta a riconoscere il browser, senza esporre l'URL completo.
    service: new URL(row.endpoint).hostname,
    createdAt: row.createdAt.toISOString(),
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
  };
}

function normalizeLocale(locale: string | undefined): PushLocale {
  return (PUSH_LOCALES as readonly string[]).includes(locale ?? "") ? (locale as PushLocale) : "it";
}

/** Registra (o aggiorna) il dispositivo dell'utente. Lo stesso browser re-iscritto passa all'utente corrente. */
export async function subscribeDevice(userId: string, input: PushSubscriptionInput) {
  if (!isAllowedPushEndpoint(input.endpoint)) {
    throw new ApiErrorException("VALIDATION_ERROR", "Endpoint push non supportato");
  }
  const data = {
    userId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    locale: normalizeLocale(input.locale),
    label: input.label?.trim().slice(0, MAX_LABEL) || null,
  };
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, ...data },
    update: data,
  });
  return serializeDevice(row);
}

export async function listDevices(userId: string) {
  const rows = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(serializeDevice);
}

export async function removeDevice(userId: string, deviceId: string) {
  const row = await prisma.pushSubscription.findUnique({ where: { id: deviceId } });
  if (!row || row.userId !== userId) throw new ApiErrorException("NOT_FOUND", "Dispositivo non trovato");
  await prisma.pushSubscription.delete({ where: { id: deviceId } });
  return { id: deviceId, deleted: true as const };
}

// --- Invio ------------------------------------------------------------------

/**
 * Invia a tutti i dispositivi degli utenti indicati; `build` produce il testo
 * nella lingua di ciascun dispositivo. Le subscription scadute (404/410)
 * vengono cancellate. Restituisce il conteggio per il test dal profilo.
 */
export async function pushToUsers(userIds: string[], build: (locale: PushLocale) => PushMessage) {
  const result = { sent: 0, failed: 0 };
  if (userIds.length === 0) return result;
  const devices = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  if (devices.length === 0) return result;
  const vapid = await getVapidKeys();

  for (const device of devices) {
    const message = build(normalizeLocale(device.locale));
    try {
      const res = await sendWebPush(device, message, vapid, { topic: message.tag });
      if (res.ok) {
        result.sent += 1;
        await prisma.pushSubscription.update({ where: { id: device.id }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
      } else {
        result.failed += 1;
        if (res.gone) await prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => undefined);
        // eslint-disable-next-line no-console
        else console.warn(`[my-planner] push rifiutata dal push service (HTTP ${res.status})`);
      }
    } catch (err) {
      result.failed += 1;
      // eslint-disable-next-line no-console
      console.error("[my-planner] invio push fallito", err);
    }
  }
  return result;
}

const TEST_TEXT: Record<PushLocale, { title: string; body: string }> = {
  it: { title: "Notifiche attive", body: "Questo dispositivo riceverà gli avvisi di My Planner." },
  en: { title: "Notifications on", body: "This device will receive My Planner alerts." },
  es: { title: "Notificaciones activadas", body: "Este dispositivo recibirá los avisos de My Planner." },
};

/** Notifica di prova verso i dispositivi dell'utente (pulsante nel profilo). */
export async function sendTestPush(userId: string) {
  return pushToUsers([userId], (locale) => ({ ...TEST_TEXT[locale], url: "/profile", tag: "test" }));
}

// --- Testi delle notifiche ---------------------------------------------------

const STATUS_TEXT: Record<PushLocale, Record<TaskStatus, string>> = {
  it: { draft: "Draft", todo: "TODO", in_progress: "In corso", testing: "Testing", done: "Done" },
  en: { draft: "Draft", todo: "To do", in_progress: "In progress", testing: "Testing", done: "Done" },
  es: { draft: "Borrador", todo: "Por hacer", in_progress: "En curso", testing: "Testing", done: "Hecho" },
};

const TEXT = {
  it: {
    mcp: "Un agente AI",
    system: "Il sistema",
    someone: "Qualcuno",
    created: (a: string, t: string) => `${a} ti ha assegnato il nuovo task «${t}»`,
    assigned: (a: string, t: string) => `${a} ti ha assegnato «${t}»`,
    moved: (a: string, t: string, f: string, to: string) => `${a} ha spostato «${t}» da ${f} a ${to}`,
    commented: (a: string, t: string) => `${a} ha commentato «${t}»`,
    aiEndTitle: (p: string) => `AI completata · ${p}`,
    aiEnd: (t: string, to: string) => `«${t}» è ora in ${to}`,
    aiEachTitle: (p: string) => `AI · ${p}`,
    aiFailed: (t: string) => `Gestione AI fermata su «${t}»`,
  },
  en: {
    mcp: "An AI agent",
    system: "The system",
    someone: "Someone",
    created: (a: string, t: string) => `${a} assigned you the new task “${t}”`,
    assigned: (a: string, t: string) => `${a} assigned you “${t}”`,
    moved: (a: string, t: string, f: string, to: string) => `${a} moved “${t}” from ${f} to ${to}`,
    commented: (a: string, t: string) => `${a} commented on “${t}”`,
    aiEndTitle: (p: string) => `AI done · ${p}`,
    aiEnd: (t: string, to: string) => `“${t}” is now in ${to}`,
    aiEachTitle: (p: string) => `AI · ${p}`,
    aiFailed: (t: string) => `AI handling stopped on “${t}”`,
  },
  es: {
    mcp: "Un agente de IA",
    system: "El sistema",
    someone: "Alguien",
    created: (a: string, t: string) => `${a} te asignó la nueva tarea «${t}»`,
    assigned: (a: string, t: string) => `${a} te asignó «${t}»`,
    moved: (a: string, t: string, f: string, to: string) => `${a} movió «${t}» de ${f} a ${to}`,
    commented: (a: string, t: string) => `${a} comentó «${t}»`,
    aiEndTitle: (p: string) => `IA completada · ${p}`,
    aiEnd: (t: string, to: string) => `«${t}» ahora está en ${to}`,
    aiEachTitle: (p: string) => `IA · ${p}`,
    aiFailed: (t: string) => `Gestión IA detenida en «${t}»`,
  },
} as const;

/** Colonna in cui il task arriva alla fine dell'ultimo passo AI scelto. */
export function aiFinalStatus(steps: AiStep[]): TaskStatusKey | null {
  const last = steps[steps.length - 1];
  if (!last) return null;
  const after: Record<AiStep, TaskStatusKey> = { triage: "todo", coder: "testing", reviewer: "done" };
  return after[last];
}

function taskPath(projectId: string, taskId: string | null) {
  return taskId ? `/projects/${projectId}?task=${taskId}` : `/projects/${projectId}`;
}

interface EventContext {
  projectName: string;
  actorUserName: string | null;
  customLabels: Record<string, string>;
}

function actorText(input: RecordTaskEventInput, ctx: EventContext, locale: PushLocale) {
  if (input.actor.type === "mcp") return TEXT[locale].mcp;
  if (input.actor.type === "system") return TEXT[locale].system;
  return ctx.actorUserName ?? TEXT[locale].someone;
}

function statusText(status: TaskStatusKey | undefined, ctx: EventContext, locale: PushLocale) {
  if (!status) return "?";
  return STATUS_TEXT[locale][status as TaskStatus] ?? ctx.customLabels[status] ?? status;
}

/** Testo della notifica "normale" (destinatario della campanella). */
export function renderEventPush(input: RecordTaskEventInput, ctx: EventContext, locale: PushLocale): PushMessage {
  const t = TEXT[locale];
  const actor = actorText(input, ctx, locale);
  const title = input.data.title || "(task)";
  let body: string;
  switch (input.type) {
    case "task.created":
      body = t.created(actor, title);
      break;
    case "task.assigned":
      body = t.assigned(actor, title);
      break;
    case "task.status_changed":
      body = t.moved(actor, title, statusText(input.data.from, ctx, locale), statusText(input.data.to, ctx, locale));
      break;
    case "comment.created":
      body = t.commented(actor, title) + (input.data.excerpt ? `\n${input.data.excerpt.slice(0, 140)}` : "");
      break;
    case "ai.failed":
      body = t.aiFailed(title) + (input.data.excerpt ? `\n${input.data.excerpt.slice(0, 140)}` : "");
      break;
    default:
      body = title;
  }
  return { title: ctx.projectName, body, url: taskPath(input.projectId, input.taskId), tag: `task-${input.taskId ?? input.projectId}` };
}

/** Testo della notifica per l'admin che segue la gestione AI del task. */
export function renderAiPush(input: RecordTaskEventInput, ctx: EventContext, locale: PushLocale, isEnd: boolean): PushMessage {
  const t = TEXT[locale];
  const title = input.data.title || "(task)";
  const to = statusText(input.data.to, ctx, locale);
  return {
    title: isEnd ? t.aiEndTitle(ctx.projectName) : t.aiEachTitle(ctx.projectName),
    body: isEnd
      ? t.aiEnd(title, to)
      : t.moved(actorText(input, ctx, locale), title, statusText(input.data.from, ctx, locale), to),
    url: taskPath(input.projectId, input.taskId),
    tag: `task-${input.taskId ?? input.projectId}`,
  };
}

// --- Aggancio agli eventi ----------------------------------------------------

/** Utenti tra quelli indicati che hanno ancora accesso al progetto (admin o membri). */
async function withProjectAccess(projectId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, OR: [{ role: "admin" }, { projects: { some: { projectId } } }] },
    select: { id: true },
  });
  return new Set(users.map((u) => u.id));
}

export async function deliverTaskEventPush(input: RecordTaskEventInput): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { name: true, archived: true } });
  if (!project || project.archived) return;

  const actorId = input.actor.type === "user" ? input.actor.id : null;

  // Admin che segue la gestione AI del task: solo sui cambi di stato.
  let aiWatcher: { id: string; isEnd: boolean } | null = null;
  if (input.type === "task.status_changed" && input.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { aiEnabled: true, aiSteps: true, aiNotify: true, aiWatcherId: true },
    });
    if (task?.aiEnabled && task.aiWatcherId && task.aiWatcherId !== actorId && task.aiNotify !== "none") {
      const isEnd = input.data.to === aiFinalStatus(normalizeAiSteps(task.aiSteps.split(",")));
      if (task.aiNotify === "each" || isEnd) aiWatcher = { id: task.aiWatcherId, isEnd };
    }
  }

  const candidates = [input.recipientId, aiWatcher?.id].filter((id): id is string => Boolean(id));
  const allowed = await withProjectAccess(input.projectId, candidates);
  if (allowed.size === 0) return;

  const [actorUser, customStatuses] = await Promise.all([
    actorId ? prisma.user.findUnique({ where: { id: actorId }, select: { firstName: true, lastName: true, email: true } }) : null,
    prisma.projectStatus.findMany({ where: { projectId: input.projectId }, select: { key: true, label: true } }),
  ]);
  const ctx: EventContext = {
    projectName: project.name,
    actorUserName: actorUser ? [actorUser.firstName, actorUser.lastName].filter(Boolean).join(" ") || actorUser.email : null,
    customLabels: Object.fromEntries(customStatuses.map((s) => [s.key, s.label])),
  };

  // Una sola push per utente: chi segue l'AI riceve la versione AI anche se e' l'assegnatario.
  if (aiWatcher && allowed.has(aiWatcher.id)) {
    const isEnd = aiWatcher.isEnd;
    await pushToUsers([aiWatcher.id], (locale) => renderAiPush(input, ctx, locale, isEnd));
  }
  if (input.recipientId && allowed.has(input.recipientId) && input.recipientId !== aiWatcher?.id) {
    await pushToUsers([input.recipientId], (locale) => renderEventPush(input, ctx, locale));
  }
}

/**
 * Accoda le push per un evento appena registrato (solo tipi notificabili,
 * vedi emitEvent). Una query rapida evita lavoro in background quando nessun
 * utente ha registrato dispositivi. Non lancia mai.
 */
export async function queueTaskEventPush(input: RecordTaskEventInput): Promise<void> {
  const anyDevice = await prisma.pushSubscription.findFirst({ select: { id: true } });
  if (!anyDevice) return;
  runInBackground("invio notifiche push fallito", () => deliverTaskEventPush(input));
}
