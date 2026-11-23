import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AuthUser, ClaudeSession } from "@my-planner/core";
import { ApiRequestError, dismissClaudeSession, listClaudeSessions } from "../api";
import { useI18n } from "../i18n";

const POLL_INTERVAL_MS = 10_000;

interface SessionsPageProps {
  currentUser: AuthUser | null;
  onOpenTask: (taskId: string, projectId: string) => void;
}

interface ProjectGroup {
  key: string;
  name: string;
  sessions: ClaudeSession[];
}

/**
 * Vista "In corso": sessioni di Claude Code aperte, divise per progetto.
 * I dati arrivano dagli hook (vedi tools/claude-hooks); polling ogni 10s
 * solo con la scheda visibile. L'ordine (chi aspetta l'utente prima) lo
 * decide il server.
 */
export function SessionsPage({ currentUser, onOpenTask }: SessionsPageProps) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setSessions(await listClaudeSessions());
      setError(null);
      setNow(Date.now());
    } catch {
      setError(t.sessions.loadError);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const groups = useMemo<ProjectGroup[]>(() => {
    const byKey = new Map<string, ProjectGroup>();
    for (const s of sessions ?? []) {
      const key = s.projectId ?? "";
      const group = byKey.get(key) ?? { key, name: s.projectName ?? t.sessions.noProject, sessions: [] };
      group.sessions.push(s);
      byKey.set(key, group);
    }
    // Progetti in ordine alfabetico, "senza progetto" in fondo.
    return [...byKey.values()].sort((a, b) =>
      a.key === "" ? 1 : b.key === "" ? -1 : a.name.localeCompare(b.name),
    );
  }, [sessions, t]);

  function ago(iso: string): string {
    const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return t.sessions.justNow;
    if (minutes < 60) return t.sessions.minutesAgo.replace("{n}", String(minutes));
    return t.sessions.hoursAgo.replace("{n}", String(Math.floor(minutes / 60)));
  }

  async function handleDismiss(session: ClaudeSession) {
    if (!window.confirm(t.sessions.dismissConfirm)) return;
    try {
      await dismissClaudeSession(session.id);
      setSessions((prev) => (prev ?? []).filter((s) => s.id !== session.id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.sessions.loadError);
    }
  }

  const canDismiss = (s: ClaudeSession) => currentUser?.role === "admin" || s.user.id === currentUser?.id;

  return (
    <div className="activity-page sessions-page">
      <p className="profile-hint">
        {t.sessions.hint}{" "}
        <Link className="guide-link" to="/profile#hook-tokens">
          {t.sessions.setupLink}
        </Link>
      </p>
      {error && <p className="login-error">{error}</p>}
      {sessions !== null && sessions.length === 0 && <p className="profile-hint">{t.sessions.empty}</p>}

      {groups.map((group) => (
        <section key={group.key} className="activity-card sessions-group">
          <h2 className="sessions-group-title">{group.name}</h2>
          <ul className="activity-list">
            {group.sessions.map((s) => {
              const statusClass = s.stale ? "stale" : s.status;
              return (
                <li key={s.id} className="activity-item session-item">
                  <span className={`session-status session-status-${statusClass}`}>
                    {t.sessions.status[s.status]}
                  </span>
                  <div className="session-body">
                    <div className="session-title">
                      {s.taskId && s.projectId ? (
                        <button type="button" className="link-button" onClick={() => onOpenTask(s.taskId!, s.projectId!)} title={t.sessions.openTask}>
                          {s.taskTitle}
                        </button>
                      ) : (
                        <span>{s.workdir ?? s.repo ?? s.sessionId.slice(0, 8)}</span>
                      )}
                    </div>
                    {s.status === "waiting_input" && s.lastMessage && <p className="session-message">{s.lastMessage}</p>}
                    {s.stale && (
                      <p className="session-message session-stale">
                        {t.sessions.stale.replace("{minutes}", String(Math.floor((now - new Date(s.lastSeenAt).getTime()) / 60_000)))}
                      </p>
                    )}
                    <div className="session-meta">
                      <span>{s.origin === "cloud" ? t.sessions.cloud : t.sessions.cli}</span>
                      {s.repo && <span>{s.repo}</span>}
                      {s.branch && <code>{s.branch}</code>}
                      <span>{t.sessions.startedBy.replace("{name}", s.user.name)}</span>
                      <span>{t.sessions.lastSeen.replace("{when}", ago(s.lastSeenAt))}</span>
                    </div>
                  </div>
                  <div className="session-actions">
                    {s.url && (
                      <a className="session-open-link" href={s.url} target="_blank" rel="noreferrer">
                        {t.sessions.openInClaude}
                      </a>
                    )}
                    {canDismiss(s) && (s.stale || s.status === "idle") && (
                      <button type="button" onClick={() => handleDismiss(s)}>
                        {t.sessions.dismiss}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
