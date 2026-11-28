import { prisma } from "../lib/prisma.js";
import type { AiBinding } from "../lib/workersAi.js";
import { SUMMARY_MODEL } from "../services/semanticService.js";

/**
 * Riepilogo giornaliero su tutti i progetti non archiviati (CF: standup via
 * Cron Trigger). A differenza di un client MCP — scoped a un solo progetto
 * dal suo token — qui si legge direttamente il DB, quindi si aggrega su
 * tutti i progetti in un colpo solo.
 *
 * Il report ha due sezioni principali: cosa e' stato chiuso ieri (giorno di
 * calendario in Europe/Rome, non "ultime 24h" a scorrimento) e cosa c'e' da
 * prendere in carico oggi (task in draft/todo). I task in corso o in testing
 * restano come terza sezione, perche' sono lavoro gia' aperto.
 */

const TZ = "Europe/Rome";

export type StandupPriority = "urgent" | "high" | "medium" | "low";

export interface StandupTask {
  title: string;
  priority: StandupPriority;
  dueDate: Date | null;
  idleDays: number;
}

export interface StandupProject {
  name: string;
  done: StandupTask[];
  inProgress: StandupTask[];
  todo: StandupTask[];
}

export interface StandupReport {
  /** Data di ieri in Europe/Rome, formato ISO (usata nell'oggetto mail). */
  yesterdayIso: string;
  /** "mercoledi' 24 settembre 2026", per l'intestazione. */
  todayLabel: string;
  yesterdayLabel: string;
  projects: StandupProject[];
  totals: { done: number; inProgress: number; todo: number };
}

// --- Fuso orario -------------------------------------------------------------
// I Worker girano in UTC: per ragionare in giorni di calendario italiani serve
// l'offset effettivo (CET/CEST) all'istante considerato.
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at.getTime();
}

function startOfLocalDay(at: Date): Date {
  const offset = tzOffsetMs(at);
  const local = new Date(at.getTime() + offset);
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // L'offset a mezzanotte puo' differire da quello di `at` nei giorni di
  // cambio ora: ricalcolalo sull'istante stimato e correggi.
  let instant = midnightAsUtc - offset;
  const midnightOffset = tzOffsetMs(new Date(instant));
  if (midnightOffset !== offset) instant = midnightAsUtc - midnightOffset;
  return new Date(instant);
}

function formatLocalDate(at: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("it-IT", { timeZone: TZ, ...opts }).format(at);
}

function isoLocalDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// --- Ordinamento -------------------------------------------------------------
const PRIORITY_ORDER: Record<StandupPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function normalizePriority(value: string): StandupPriority {
  return value === "urgent" || value === "high" || value === "low" ? value : "medium";
}

function byPriorityThenDueDate(a: StandupTask, b: StandupTask): number {
  const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (p !== 0) return p;
  const da = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const db = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return a.title.localeCompare(b.title, "it");
}

export async function buildStandupReport(now: Date = new Date()): Promise<StandupReport> {
  const todayStart = startOfLocalDay(now);
  // Meta' pomeriggio di "ieri": evita i buchi/doppioni del cambio ora quando
  // si sottraggono 24h secche a mezzanotte.
  const yesterdayStart = startOfLocalDay(new Date(todayStart.getTime() - 12 * 60 * 60 * 1000));

  const projects = await prisma.project.findMany({
    where: { archived: false },
    include: { tasks: { where: { parentId: null } } },
    orderBy: { name: "asc" },
  });

  const toView = (t: { title: string; priority: string; dueDate: Date | null; updatedAt: Date }): StandupTask => ({
    title: t.title,
    priority: normalizePriority(t.priority),
    dueDate: t.dueDate ?? null,
    idleDays: Math.max(0, Math.floor((now.getTime() - t.updatedAt.getTime()) / (24 * 60 * 60 * 1000))),
  });

  const sections: StandupProject[] = [];
  const totals = { done: 0, inProgress: 0, todo: 0 };

  for (const project of projects) {
    const done = project.tasks
      .filter((t) => t.status === "done" && t.updatedAt >= yesterdayStart && t.updatedAt < todayStart)
      .map(toView)
      .sort(byPriorityThenDueDate);
    const inProgress = project.tasks
      .filter((t) => t.status === "in_progress" || t.status === "testing")
      .map(toView)
      .sort(byPriorityThenDueDate);
    const todo = project.tasks
      .filter((t) => t.status === "draft" || t.status === "todo")
      .map(toView)
      .sort(byPriorityThenDueDate);

    if (done.length === 0 && inProgress.length === 0 && todo.length === 0) continue;

    totals.done += done.length;
    totals.inProgress += inProgress.length;
    totals.todo += todo.length;
    sections.push({ name: project.name, done, inProgress, todo });
  }

  const yesterday = new Date(yesterdayStart.getTime() + 12 * 60 * 60 * 1000);
  return {
    yesterdayIso: isoLocalDate(yesterday),
    todayLabel: formatLocalDate(now, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    yesterdayLabel: formatLocalDate(yesterday, { weekday: "long", day: "numeric", month: "long" }),
    projects: sections,
    totals,
  };
}

// --- Riassunto in linguaggio naturale (Workers AI) ---------------------------

/** Task per sezione passati al modello: oltre, conta solo il totale. */
const SUMMARY_MAX_TASKS = 15;
const SUMMARY_MAX_CHARS = 1500;

function compactForPrompt(report: StandupReport) {
  const pick = (tasks: StandupTask[], extra: (t: StandupTask) => Record<string, unknown>) => ({
    count: tasks.length,
    tasks: tasks.slice(0, SUMMARY_MAX_TASKS).map((t) => ({ title: t.title, ...extra(t) })),
  });
  return {
    today: report.todayLabel,
    yesterday: report.yesterdayLabel,
    totals: report.totals,
    projects: report.projects.map((p) => ({
      name: p.name,
      doneYesterday: pick(p.done, () => ({})),
      inProgress: pick(p.inProgress, (t) => ({ idleDays: t.idleDays, priority: t.priority })),
      toDo: pick(p.todo, (t) => ({
        priority: t.priority,
        due: t.dueDate ? isoLocalDate(t.dueDate) : null,
      })),
    })),
  };
}

/**
 * Riassunto discorsivo dello standup con un LLM di Workers AI. Best-effort:
 * null se il binding manca, la quota e' finita o il modello non risponde, e
 * la mail parte comunque con il solo dettaglio.
 */
export async function summarizeStandup(report: StandupReport, ai: AiBinding | null | undefined): Promise<string | null> {
  if (!ai || report.projects.length === 0) return null;
  try {
    const out = await ai.run(SUMMARY_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "Sei l'assistente di un project manager. Ricevi in JSON lo stato dei progetti e scrivi lo standup " +
            "del mattino in italiano, in prosa: 3-6 frasi, tono diretto e cordiale, niente elenchi puntati, " +
            "niente markdown, niente saluti finali. Di' cosa e' stato chiuso ieri, cosa e' in corso (segnala " +
            "i task fermi da piu' giorni) e su cosa conviene concentrarsi oggi, privilegiando priorita' alta/" +
            "urgente e scadenze vicine. Non inventare task che non sono nei dati.",
        },
        { role: "user", content: JSON.stringify(compactForPrompt(report)) },
      ],
      max_tokens: 400,
      temperature: 0.4,
    });
    const text = String((out as { response?: unknown })?.response ?? "")
      .replace(/[*_#`]/g, "")
      .trim();
    return text ? text.slice(0, SUMMARY_MAX_CHARS) : null;
  } catch (err) {
    console.error("[my-planner] riassunto dello standup non riuscito", err);
    return null;
  }
}

// --- Rendering ---------------------------------------------------------------

const PRIORITY_LABEL: Record<StandupPriority, string> = {
  urgent: "urgente",
  high: "alta",
  medium: "media",
  low: "bassa",
};

const PRIORITY_STYLE: Record<StandupPriority, { fg: string; bg: string }> = {
  urgent: { fg: "#912018", bg: "#fee4e2" },
  high: { fg: "#93370d", bg: "#fef0c7" },
  medium: { fg: "#175cd3", bg: "#d1e9ff" },
  low: { fg: "#475467", bg: "#eaecf0" },
};

function formatDueDate(date: Date): string {
  return formatLocalDate(date, { day: "numeric", month: "short" });
}

/** Versione testuale, usata come fallback multipart/alternative. */
export function renderStandupText(report: StandupReport, summary: string | null = null): string {
  const head = [
    `Standup my-planner — ${report.todayLabel}`,
    `Fatto ieri: ${report.totals.done} · In corso: ${report.totals.inProgress} · Da fare oggi: ${report.totals.todo}`,
    ...(summary ? ["", summary, "", "--- Dettaglio ---"] : []),
  ];

  if (report.projects.length === 0) {
    return [...head, "", "Nessuna attivita' da segnalare."].join("\n");
  }

  const blocks = report.projects.map((project) => {
    const lines: string[] = [`== ${project.name} ==`];
    if (project.done.length) {
      lines.push(`Fatto ieri (${project.done.length}):`);
      lines.push(...project.done.map((t) => `  [x] ${t.title}`));
    }
    if (project.inProgress.length) {
      lines.push(`In corso (${project.inProgress.length}):`);
      lines.push(...project.inProgress.map((t) => `  [~] ${t.title} (fermo da ${t.idleDays}g)`));
    }
    if (project.todo.length) {
      lines.push(`Da fare oggi (${project.todo.length}):`);
      lines.push(
        ...project.todo.map((t) => {
          const due = t.dueDate ? `, scade ${formatDueDate(t.dueDate)}` : "";
          return `  [ ] ${t.title} (priorita' ${PRIORITY_LABEL[t.priority]}${due})`;
        })
      );
    }
    return lines.join("\n");
  });

  return [...head, "", blocks.join("\n\n")].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statTile(label: string, value: number, color: string): string {
  return `<td width="33.33%" style="padding:0 4px;" valign="top">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e4e7ec;border-radius:10px;background:#ffffff;">
    <tr><td style="padding:12px 14px;">
      <div style="font-size:24px;line-height:1;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:11px;line-height:1.4;color:#667085;text-transform:uppercase;letter-spacing:.06em;padding-top:6px;">${label}</div>
    </td></tr>
  </table>
</td>`;
}

function badge(priority: StandupPriority): string {
  const { fg, bg } = PRIORITY_STYLE[priority];
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:600;line-height:1;padding:3px 7px;border-radius:20px;white-space:nowrap;">${PRIORITY_LABEL[priority]}</span>`;
}

function taskRow(dot: string, body: string): string {
  return `<tr>
  <td width="16" valign="top" style="padding:5px 0 5px 0;font-size:13px;line-height:20px;color:${dot};">&#9679;</td>
  <td valign="top" style="padding:5px 0 5px 4px;font-size:14px;line-height:20px;color:#344054;">${body}</td>
</tr>`;
}

function groupHtml(title: string, color: string, rows: string[]): string {
  if (rows.length === 0) return "";
  return `<div style="padding:14px 0 2px;">
  <div style="font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px;">${title} (${rows.length})</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>
</div>`;
}

function projectHtml(project: StandupProject): string {
  const done = groupHtml(
    "Fatto ieri",
    "#067647",
    project.done.map((t) => taskRow("#17b26a", `<span style="color:#475467;">${escapeHtml(t.title)}</span>`))
  );
  const inProgress = groupHtml(
    "In corso",
    "#175cd3",
    project.inProgress.map((t) =>
      taskRow(
        "#2e90fa",
        `${escapeHtml(t.title)} <span style="color:#98a2b3;font-size:12px;">· fermo da ${t.idleDays}g</span>`
      )
    )
  );
  const todo = groupHtml(
    "Da fare oggi",
    "#b54708",
    project.todo.map((t) => {
      const due = t.dueDate
        ? ` <span style="color:#98a2b3;font-size:12px;">· scade ${escapeHtml(formatDueDate(t.dueDate))}</span>`
        : "";
      return taskRow("#f79009", `${escapeHtml(t.title)} ${badge(t.priority)}${due}`);
    })
  );

  return `<tr><td style="padding:8px 28px 18px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eaecf0;">
    <tr><td style="padding-top:18px;">
      <div style="font-size:16px;font-weight:700;color:#101828;">${escapeHtml(project.name)}</div>
      ${done}${inProgress}${todo}
    </td></tr>
  </table>
</td></tr>`;
}

/** Versione HTML: tabelle + stile inline, l'unico HTML affidabile nei client mail. */
export function renderStandupHtml(report: StandupReport, summary: string | null = null): string {
  const preheader = summary
    ? summary.slice(0, 140)
    : `Fatto ieri: ${report.totals.done} · In corso: ${report.totals.inProgress} · Da fare oggi: ${report.totals.todo}`;

  const summaryHtml = summary
    ? `<tr><td style="padding:18px 28px 4px;">
    <div style="background:#f9fafb;border:1px solid #eaecf0;border-left:4px solid #7a5af8;border-radius:10px;padding:14px 16px;font-size:15px;line-height:1.6;color:#344054;">${escapeHtml(summary).replace(/\n+/g, "<br><br>")}</div>
  </td></tr>`
    : "";
  const detailLabel =
    summary && report.projects.length > 0
      ? `<tr><td style="padding:18px 28px 0;font-size:12px;font-weight:700;color:#667085;text-transform:uppercase;letter-spacing:.06em;">Dettaglio</td></tr>`
      : "";

  const body =
    report.projects.length === 0
      ? `<tr><td style="padding:24px 28px 8px;font-size:14px;color:#667085;">Nessuna attivita' da segnalare: nessun task chiuso ieri, nessuno in corso e nessuna bozza in attesa.</td></tr>`
      : report.projects.map(projectHtml).join("");

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Standup my-planner</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f4f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <tr><td style="background:#101828;padding:24px 28px;">
    <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-.01em;">Standup my-planner</div>
    <div style="font-size:13px;color:#98a2b3;padding-top:4px;">${escapeHtml(report.todayLabel)}</div>
  </td></tr>

  ${summaryHtml}

  <tr><td style="padding:18px 24px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${statTile("Fatto ieri", report.totals.done, "#067647")}
      ${statTile("In corso", report.totals.inProgress, "#175cd3")}
      ${statTile("Da fare oggi", report.totals.todo, "#b54708")}
    </tr></table>
  </td></tr>

  ${detailLabel}
  ${body}

  <tr><td style="padding:8px 28px 24px;">
    <div style="border-top:1px solid #eaecf0;padding-top:14px;font-size:12px;color:#98a2b3;line-height:1.5;">
      Riepilogo automatico di my-planner, ogni mattina alle 08:00.<br>
      "Fatto ieri" copre ${escapeHtml(report.yesterdayLabel)}; "da fare oggi" elenca i task ancora in bozza.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}
