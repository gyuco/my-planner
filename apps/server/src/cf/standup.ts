import { prisma } from "../lib/prisma.js";

/**
 * Riepilogo giornaliero su tutti i progetti non archiviati (CF: standup via
 * Cron Trigger). A differenza di un client MCP — scoped a un solo progetto
 * dal suo token — qui si legge direttamente il DB, quindi si aggrega su
 * tutti i progetti in un colpo solo.
 */
export async function buildStandupSummary(): Promise<string> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const projects = await prisma.project.findMany({
    where: { archived: false },
    include: { tasks: { where: { parentId: null } } },
  });

  const sections: string[] = [];
  for (const project of projects) {
    const tasks = project.tasks;
    const doneRecent = tasks.filter((t) => t.status === "done" && t.updatedAt >= since);
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    const urgentDraft = tasks.filter((t) => t.status === "draft" && (t.priority === "urgent" || t.priority === "high"));

    if (doneRecent.length === 0 && inProgress.length === 0 && urgentDraft.length === 0) continue;

    const lines: string[] = [`== ${project.name} ==`];
    if (doneRecent.length) {
      lines.push(`Completati nelle ultime 24h (${doneRecent.length}):`);
      lines.push(...doneRecent.map((t) => `  - ${t.title}`));
    }
    if (inProgress.length) {
      lines.push(`In corso (${inProgress.length}):`);
      lines.push(...inProgress.map((t) => `  - ${t.title} (fermo da ${daysSince(t.updatedAt)}g)`));
    }
    if (urgentDraft.length) {
      lines.push(`Da prendere in carico, priorita' alta/urgente (${urgentDraft.length}):`);
      lines.push(...urgentDraft.map((t) => `  - [${t.priority}] ${t.title}`));
    }
    sections.push(lines.join("\n"));
  }

  return sections.length ? sections.join("\n\n") : "Nessuna attivita' rilevante nelle ultime 24h su nessun progetto.";
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}
