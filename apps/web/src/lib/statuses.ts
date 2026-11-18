import { TASK_STATUSES, isBaseStatus, type Board, type ProjectStatus, type TaskStatus } from "@my-planner/core";
import type { Dictionary as Messages } from "../i18n/en";

/** Etichette tradotte dei 5 stati di base. */
export function baseStatusLabels(t: Messages): Record<TaskStatus, string> {
  return {
    draft: t.board.draft,
    todo: t.board.todo,
    in_progress: t.board.inProgress,
    testing: t.board.testing,
    done: t.board.done,
  };
}

/** Mappa chiave -> etichetta degli stati personalizzati di un progetto. */
export function customStatusLabels(statuses: ProjectStatus[]): Record<string, string> {
  return Object.fromEntries(statuses.filter((s) => !s.builtIn).map((s) => [s.key, s.label]));
}

/**
 * Etichetta di uno stato: tradotta per gli stati di base, il nome scelto per
 * quelli personalizzati (la chiave se il nome non e' noto, es. board aggregata).
 */
export function statusLabel(t: Messages, key: string, custom: Record<string, string> = {}): string {
  if (isBaseStatus(key)) return baseStatusLabels(t)[key];
  return custom[key] ?? key;
}

/**
 * Chiavi delle colonne nell'ordine restituito dal server (stati di base +
 * personalizzati, vedi `orderedStatusKeys` nel core). Gli stati di base ci
 * sono sempre, anche con una risposta parziale.
 */
export function boardStatusKeys(board: Board): string[] {
  const keys = Object.keys(board);
  for (const s of TASK_STATUSES) if (!keys.includes(s)) keys.push(s);
  return keys;
}
