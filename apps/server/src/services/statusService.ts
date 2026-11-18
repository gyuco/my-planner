import {
  ApiErrorException,
  CUSTOM_STATUS_KEY_PATTERN,
  TASK_STATUSES,
  isBaseStatus,
  orderedStatusKeys,
  statusKeyFromLabel,
  type ProjectStatus,
  type TaskStatusKey,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";

/**
 * Stati personalizzati per progetto (tabella ProjectStatus), condivisi tra
 * REST e MCP. I 5 stati di base non sono salvati: esistono sempre, non si
 * rinominano e non si cancellano. Gli stati personalizzati hanno una chiave
 * stabile (Task.status) e un'etichetta modificabile.
 */

const LABEL_MAX = 50;

async function assertProjectExists(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");
}

function normalizeLabel(label: string): string {
  const trimmed = (label ?? "").trim();
  if (trimmed.length === 0 || trimmed.length > LABEL_MAX) {
    throw new ApiErrorException("VALIDATION_ERROR", `Il nome dello stato deve avere tra 1 e ${LABEL_MAX} caratteri`);
  }
  return trimmed;
}

/** Stati personalizzati del progetto, nell'ordine delle colonne. */
export async function listCustomStatuses(projectId: string) {
  return prisma.projectStatus.findMany({
    where: { projectId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** Chiavi degli stati personalizzati dei progetti indicati (unione, ordine stabile). */
export async function listCustomStatusKeys(projectIds: string[] | undefined): Promise<string[]> {
  const rows = await prisma.projectStatus.findMany({
    where: projectIds ? { projectId: { in: projectIds } } : { project: { archived: false } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { key: true },
  });
  return Array.from(new Set(rows.map((r) => r.key)));
}

function toProjectStatus(row: { key: string; label: string }): ProjectStatus {
  return { key: row.key, label: row.label, builtIn: false };
}

/** Tutti gli stati del progetto (base + personalizzati) nell'ordine delle colonne. */
export async function listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  await assertProjectExists(projectId);
  const custom = await listCustomStatuses(projectId);
  const byKey = new Map(custom.map((c) => [c.key, c]));
  return orderedStatusKeys(custom.map((c) => c.key)).map((key) => {
    const row = byKey.get(key);
    return row ? toProjectStatus(row) : { key, label: key, builtIn: true };
  });
}

/**
 * Converte lo stato ricevuto (REST/MCP) nella chiave salvata su Task.status.
 * Accetta uno stato di base, la chiave di uno stato personalizzato del
 * progetto o la sua etichetta (senza distinzione maiuscole/minuscole).
 */
export async function resolveStatus(projectId: string, input: string): Promise<TaskStatusKey> {
  const value = (input ?? "").trim();
  if (isBaseStatus(value)) return value;
  const custom = await listCustomStatuses(projectId);
  const lower = value.toLowerCase();
  const match =
    custom.find((c) => c.key === value) ??
    custom.find((c) => c.key === lower) ??
    custom.find((c) => c.label.toLowerCase() === lower);
  if (match) return match.key;
  const valid = [...TASK_STATUSES, ...custom.map((c) => c.key)].join(" | ");
  throw new ApiErrorException("VALIDATION_ERROR", `Stato "${value}" non valido per questo progetto. Stati validi: ${valid}`);
}

export async function createProjectStatus(projectId: string, rawLabel: string): Promise<ProjectStatus> {
  await assertProjectExists(projectId);
  const label = normalizeLabel(rawLabel);
  const base = statusKeyFromLabel(label);
  if (!CUSTOM_STATUS_KEY_PATTERN.test(base)) {
    throw new ApiErrorException("VALIDATION_ERROR", "Il nome dello stato deve contenere almeno una lettera o un numero");
  }

  const existing = await listCustomStatuses(projectId);
  const lower = label.toLowerCase();
  if (isBaseStatus(lower) || existing.some((c) => c.label.toLowerCase() === lower)) {
    throw new ApiErrorException("CONFLICT", `Esiste gia' uno stato "${label}" in questo progetto`);
  }

  const taken = new Set<string>([...TASK_STATUSES, ...existing.map((c) => c.key)]);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 36)}-${n}`;

  const position = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;
  const row = await prisma.projectStatus.create({ data: { projectId, key, label, position } });
  return toProjectStatus(row);
}

async function getCustomStatusOrThrow(projectId: string, key: string) {
  if (isBaseStatus(key)) {
    throw new ApiErrorException("VALIDATION_ERROR", "Gli stati di base non si possono modificare ne' cancellare");
  }
  const row = await prisma.projectStatus.findUnique({ where: { projectId_key: { projectId, key } } });
  if (!row) throw new ApiErrorException("NOT_FOUND", "Stato non trovato");
  return row;
}

/** Rinomina uno stato personalizzato: cambia solo l'etichetta, la chiave resta. */
export async function renameProjectStatus(projectId: string, key: string, rawLabel: string): Promise<ProjectStatus> {
  const row = await getCustomStatusOrThrow(projectId, key);
  const label = normalizeLabel(rawLabel);
  const lower = label.toLowerCase();
  const others = await prisma.projectStatus.findMany({ where: { projectId, NOT: { id: row.id } }, select: { label: true } });
  if (isBaseStatus(lower) || others.some((o) => o.label.toLowerCase() === lower)) {
    throw new ApiErrorException("CONFLICT", `Esiste gia' uno stato "${label}" in questo progetto`);
  }
  const updated = await prisma.projectStatus.update({ where: { id: row.id }, data: { label } });
  return toProjectStatus(updated);
}

/** Cancella uno stato personalizzato, solo se nessun task del progetto lo usa. */
export async function deleteProjectStatus(projectId: string, key: string) {
  const row = await getCustomStatusOrThrow(projectId, key);
  const inUse = await prisma.task.count({ where: { projectId, status: key } });
  if (inUse > 0) {
    throw new ApiErrorException("CONFLICT", `Lo stato "${row.label}" e' usato da ${inUse} task: spostali prima di cancellarlo`);
  }
  await prisma.projectStatus.delete({ where: { id: row.id } });
  return { key, deleted: true as const };
}
