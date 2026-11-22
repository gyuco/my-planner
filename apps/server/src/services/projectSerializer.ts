/**
 * Progetto come esposto da REST e MCP. Le colonne interne (in particolare il
 * token cifrato della routine AI) non escono mai dal server: qui si sceglie
 * esplicitamente cosa esporre.
 */
export function serializeProject<T extends {
  id: string;
  name: string;
  archived: boolean;
  createdAt: Date;
  repoUrl?: string | null;
  groupName?: string | null;
  aiRoutineId?: string | null;
  aiRoutineTokenEncrypted?: string | null;
}>(row: T) {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived,
    createdAt: row.createdAt,
    repoUrl: row.repoUrl ?? null,
    groupName: row.groupName ?? null,
    /** true se la routine Claude Code per l'avvio automatico dei passi AI e' configurata. */
    aiRoutineConfigured: Boolean(row.aiRoutineId && row.aiRoutineTokenEncrypted),
  };
}
