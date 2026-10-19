import type { TaskStatus } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { sendMail, type MailMessage } from "../lib/email/smtp.js";
import { getSmtpSocketFactory, runInBackground } from "../lib/email/provider.js";
import { getActiveEmailConfig, type ActiveEmailConfig } from "./emailSettingsService.js";
import type { RecordTaskEventInput } from "./notificationService.js";

/**
 * Email per gli eventi di notifica (stessi eventi della campanella in-app).
 *
 * Destinatari = chi vedrebbe la notifica in-app: admin + manager associati
 * al progetto, escluso l'autore dell'azione, progetti archiviati esclusi.
 *
 * Mai bloccante: senza config SMTP valida non parte nulla, e l'invio vero
 * avviene in background, quindi errori SMTP o timeout non toccano la
 * mutazione né la notifica in-app (vedi emitEvent in taskService).
 */

// Gmail via SMTP accetta al massimo 100 destinatari per messaggio.
const MAX_RECIPIENTS_PER_MESSAGE = 50;

const STATUS_LABELS: Record<TaskStatus, string> = {
  draft: "Bozza",
  todo: "Da fare",
  in_progress: "In corso",
  testing: "In test",
  done: "Fatto",
};

function statusLabel(status: TaskStatus | undefined): string {
  return status ? (STATUS_LABELS[status] ?? status) : "?";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function findRecipients(projectId: string, actorId: string | null): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      OR: [{ role: "admin" }, { projects: { some: { projectId } } }],
      ...(actorId ? { id: { not: actorId } } : {}),
    },
    select: { email: true },
  });
  return users.map((u) => u.email);
}

async function actorLabel(input: RecordTaskEventInput): Promise<string> {
  if (input.actor.type === "mcp") return "Un agente MCP";
  if (input.actor.type === "system") return "Il sistema";
  const user = await prisma.user.findUnique({
    where: { id: input.actor.id },
    select: { firstName: true, lastName: true, email: true },
  });
  if (!user) return "Un utente";
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderTaskEventEmail(
  input: RecordTaskEventInput,
  ctx: { projectName: string; actorName: string; appUrl: string | null },
): RenderedEmail {
  const title = input.data.title || "(task)";
  let summary: string;
  switch (input.type) {
    case "task.created":
      summary = `${ctx.actorName} ha creato il task "${title}"`;
      break;
    case "task.status_changed":
      summary = `${ctx.actorName} ha spostato "${title}" da ${statusLabel(input.data.from)} a ${statusLabel(input.data.to)}`;
      break;
    case "comment.created":
      summary = `${ctx.actorName} ha commentato "${title}"`;
      break;
    default:
      summary = `${ctx.actorName} ha aggiornato "${title}"`;
  }

  const excerpt = input.data.excerpt?.trim() || null;
  const footer = "Ricevi questa email perché hai accesso al progetto su my-planner.";

  const text = [
    summary,
    `Progetto: ${ctx.projectName}`,
    ...(excerpt ? ["", excerpt] : []),
    ...(ctx.appUrl ? ["", `Apri my-planner: ${ctx.appUrl}`] : []),
    "",
    "--",
    footer,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(summary)}</p>`,
    `<p style="color:#666">Progetto: <strong>${escapeHtml(ctx.projectName)}</strong></p>`,
    excerpt
      ? `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ccc;color:#333;white-space:pre-wrap">${escapeHtml(excerpt)}</blockquote>`
      : "",
    ctx.appUrl ? `<p><a href="${escapeHtml(ctx.appUrl)}">Apri my-planner</a></p>` : "",
    `<p style="color:#999;font-size:12px">${escapeHtml(footer)}</p>`,
  ].join("\n");

  return { subject: `[${ctx.projectName}] ${summary}`, text, html };
}

async function deliverTaskEventEmail(config: ActiveEmailConfig, input: RecordTaskEventInput): Promise<void> {
  const factory = getSmtpSocketFactory();
  if (!factory) return;

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { name: true, archived: true },
  });
  if (!project || project.archived) return;

  const recipients = await findRecipients(input.projectId, input.actor.type === "user" ? input.actor.id : null);
  if (recipients.length === 0) return;

  const rendered = renderTaskEventEmail(input, {
    projectName: project.name,
    actorName: await actorLabel(input),
    appUrl: config.appUrl,
  });

  for (let i = 0; i < recipients.length; i += MAX_RECIPIENTS_PER_MESSAGE) {
    const message: MailMessage = { ...rendered, to: recipients.slice(i, i + MAX_RECIPIENTS_PER_MESSAGE) };
    await sendMail(factory, config.smtp, message);
  }
}

/**
 * Accoda l'email per un evento appena registrato. Legge la config in modo
 * sincrono (una query) cosi' che, senza SMTP configurato, non venga creato
 * alcun lavoro in background. Non lancia mai.
 */
export async function queueTaskEventEmail(input: RecordTaskEventInput): Promise<void> {
  const config = await getActiveEmailConfig();
  if (!config) return;
  runInBackground("invio email di notifica fallito", () => deliverTaskEventEmail(config, input));
}
