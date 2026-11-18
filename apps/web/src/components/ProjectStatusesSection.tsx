import { useEffect, useState } from "react";
import type { ProjectStatus } from "@my-planner/core";
import {
  ApiRequestError,
  createProjectStatus,
  deleteProjectStatus,
  listProjectStatuses,
  renameProjectStatus,
} from "../api";
import { useI18n } from "../i18n";
import { statusLabel } from "../lib/statuses";

interface ProjectStatusesSectionProps {
  projectId: string;
  /** Chiamata dopo ogni creazione/rinomina/cancellazione (ricarica board e nomi). */
  onChanged: () => void;
}

/**
 * Stati del progetto nelle impostazioni: i 5 di base (fissi) e quelli
 * personalizzati, che si possono creare, rinominare e cancellare (solo se
 * nessun task li usa: lo verifica il server).
 */
export function ProjectStatusesSection({ projectId, onChanged }: ProjectStatusesSectionProps) {
  const { t } = useI18n();
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  async function load() {
    try {
      setStatuses(await listProjectStatuses(projectId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.projectSettings.statusesLoadError);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    if (await run(() => createProjectStatus(projectId, label), t.projectSettings.statusCreateError)) {
      setNewLabel("");
    }
  }

  async function handleRename(e: React.FormEvent, status: ProjectStatus) {
    e.preventDefault();
    const label = editLabel.trim();
    if (!label || label === status.label) {
      setEditingKey(null);
      return;
    }
    if (await run(() => renameProjectStatus(projectId, status.key, label), t.projectSettings.statusRenameError)) {
      setEditingKey(null);
    }
  }

  async function handleDelete(status: ProjectStatus) {
    if (!window.confirm(t.projectSettings.statusDeleteConfirm.replace("{name}", status.label))) return;
    await run(() => deleteProjectStatus(projectId, status.key), t.projectSettings.statusDeleteError);
  }

  return (
    <section className="drawer-section">
      <h3>{t.projectSettings.statuses}</h3>
      <p className="drawer-hint">{t.projectSettings.statusesHint}</p>
      <form className="drawer-inline-form" onSubmit={handleCreate}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={t.projectSettings.statusPlaceholder}
          maxLength={50}
          aria-label={t.projectSettings.statusPlaceholder}
        />
        <button type="submit" disabled={busy || !newLabel.trim()}>
          {t.projectSettings.addStatus}
        </button>
      </form>

      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}

      <ul className="drawer-list status-list">
        {statuses.map((status) => (
          <li key={status.key}>
            {editingKey === status.key ? (
              <form className="drawer-inline-form status-edit-form" onSubmit={(e) => handleRename(e, status)}>
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  maxLength={50}
                  autoFocus
                  aria-label={t.projectSettings.statusNameAria}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingKey(null);
                  }}
                />
                <button type="submit" disabled={busy || !editLabel.trim()}>
                  {t.common.save}
                </button>
                <button type="button" onClick={() => setEditingKey(null)} disabled={busy}>
                  {t.common.cancel}
                </button>
              </form>
            ) : (
              <>
                <span>
                  <span className={`column-picker-dot column-picker-dot-${status.builtIn ? status.key : "custom"}`} />{" "}
                  {statusLabel(t, status.key, status.builtIn ? {} : { [status.key]: status.label })}{" "}
                  {status.builtIn ? (
                    <span className="token-status">{t.projectSettings.statusBuiltIn}</span>
                  ) : (
                    <code className="status-key">{status.key}</code>
                  )}
                </span>
                {!status.builtIn && (
                  <div className="drawer-list-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingKey(status.key);
                        setEditLabel(status.label);
                      }}
                    >
                      {t.projectSettings.rename}
                    </button>
                    <button type="button" disabled={busy} onClick={() => handleDelete(status)}>
                      {t.projectSettings.deleteStatus}
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
