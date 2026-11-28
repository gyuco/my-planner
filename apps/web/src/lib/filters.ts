import type { TaskPriority } from "@my-planner/core";
import type { BoardFiltersState } from "../components/FilterBar";

/**
 * Filtri della board nel query string, cosi' un link condiviso riproduce la
 * stessa vista: assignedToMe=1, assignee=<id|__unassigned__>, priority=a,b,
 * blocked=1, q=<testo>, tag=<tag>, subtasks=1, projects=<id,id> (solo "all").
 */
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export function parseFilters(search: string): BoardFiltersState {
  const p = new URLSearchParams(search);
  return {
    assignedToMe: p.get("assignedToMe") === "1",
    assignee: p.get("assignee") || null,
    priorities: (p.get("priority") ?? "")
      .split(",")
      .filter((x): x is TaskPriority => (PRIORITIES as string[]).includes(x)),
    blockedOnly: p.get("blocked") === "1",
    search: p.get("q") ?? "",
    tag: p.get("tag") || null,
    showSubtasks: p.get("subtasks") === "1",
  };
}

export function parseProjectIds(search: string): string[] | null {
  const ids = (new URLSearchParams(search).get("projects") ?? "").split(",").filter(Boolean);
  return ids.length > 0 ? ids : null;
}

function setOrDelete(p: URLSearchParams, key: string, value: string | null) {
  if (value) p.set(key, value);
  else p.delete(key);
}

export function writeFilters(p: URLSearchParams, f: BoardFiltersState): void {
  setOrDelete(p, "assignedToMe", f.assignedToMe ? "1" : null);
  setOrDelete(p, "assignee", f.assignee);
  setOrDelete(p, "priority", f.priorities.length > 0 ? f.priorities.join(",") : null);
  setOrDelete(p, "blocked", f.blockedOnly ? "1" : null);
  setOrDelete(p, "q", f.search || null);
  setOrDelete(p, "tag", f.tag);
  setOrDelete(p, "subtasks", f.showSubtasks ? "1" : null);
}

export function writeProjectIds(p: URLSearchParams, ids: string[] | null): void {
  setOrDelete(p, "projects", ids && ids.length > 0 ? ids.join(",") : null);
}

/** Query string dei soli filtri (senza `task`), per portarli su un altro progetto/vista. */
export function filtersSearch(search: string, keepProjects: boolean): string {
  const p = new URLSearchParams(search);
  p.delete("task");
  if (!keepProjects) p.delete("projects");
  const out = p.toString();
  return out ? `?${out}` : "";
}
