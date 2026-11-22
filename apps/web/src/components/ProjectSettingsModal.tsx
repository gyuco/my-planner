import { useEffect, useState } from "react";
import type { Project, ProjectToken } from "@my-planner/core";
import {
  ApiRequestError,
  archiveProject,
  createProjectToken,
  listProjectTokens,
  renameProject,
  setProjectGroup,
  setProjectRepo,
  revokeProjectToken,
} from "../api";
import { useI18n } from "../i18n";
import { ProjectStatusesSection } from "./ProjectStatusesSection";
import { AiRoutineSection } from "./AiRoutineSection";
import { mcpBaseUrl } from "../lib/mcp";

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onChanged: () => void;
  /** Stati personalizzati creati/rinominati/cancellati. */
  onStatusesChanged?: () => void;
  /** La sezione dell'avvio automatico AI (routine) e' solo per gli admin. */
  isAdmin?: boolean;
  /** Gruppi gia' usati dagli altri progetti, proposti come suggerimenti. */
  existingGroups?: string[];
}

export function ProjectSettingsModal({
  project,
  onClose,
  onChanged,
  onStatusesChanged,
  isAdmin = false,
  existingGroups = [],
}: ProjectSettingsModalProps) {
  const { t, formatDate } = useI18n();
  const [name, setName] = useState(project.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState(project.groupName ?? "");
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupSaved, setGroupSaved] = useState(false);
  const [repoUrl, setRepoUrl] = useState(project.repoUrl ?? "");
  const [savingRepo, setSavingRepo] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoSaved, setRepoSaved] = useState(false);

  const [tokens, setTokens] = useState<ProjectToken[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [copyConfigFeedback, setCopyConfigFeedback] = useState(false);

  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function loadTokens() {
    try {
      const list = await listProjectTokens(project.id);
      setTokens(list);
      setTokensError(null);
    } catch (err) {
      setTokensError(err instanceof ApiRequestError ? err.message : t.projectSettings.loadTokensError);
    }
  }

  useEffect(() => {
    loadTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    setRenameError(null);
    if (!name.trim() || name === project.name) return;
    setRenaming(true);
    try {
      await renameProject(project.id, name.trim());
      onChanged();
    } catch (err) {
      setRenameError(err instanceof ApiRequestError ? err.message : t.projectSettings.renameError);
    } finally {
      setRenaming(false);
    }
  }

  async function handleSaveGroup(e: React.FormEvent) {
    e.preventDefault();
    setGroupError(null);
    setGroupSaved(false);
    setSavingGroup(true);
    try {
      const updated = await setProjectGroup(project.id, groupName.trim() || null);
      setGroupName(updated.groupName ?? "");
      setGroupSaved(true);
      onChanged();
    } catch (err) {
      setGroupError(err instanceof ApiRequestError ? err.message : t.projectSettings.groupError);
    } finally {
      setSavingGroup(false);
    }
  }

  async function handleSaveRepo(e: React.FormEvent) {
    e.preventDefault();
    setRepoError(null);
    setRepoSaved(false);
    setSavingRepo(true);
    try {
      const updated = await setProjectRepo(project.id, repoUrl.trim() || null);
      setRepoUrl(updated.repoUrl ?? "");
      setRepoSaved(true);
      onChanged();
    } catch (err) {
      setRepoError(err instanceof ApiRequestError ? err.message : t.projectSettings.repoError);
    } finally {
      setSavingRepo(false);
    }
  }

  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault();
    setTokensError(null);
    setCreatingToken(true);
    try {
      const created = await createProjectToken(project.id, newLabel.trim() || undefined);
      setRevealedToken(created.token);
      setNewLabel("");
      await loadTokens();
    } catch (err) {
      setTokensError(err instanceof ApiRequestError ? err.message : t.projectSettings.createTokenError);
    } finally {
      setCreatingToken(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    if (!window.confirm(t.projectSettings.revokeConfirm)) return;
    try {
      await revokeProjectToken(project.id, tokenId);
      await loadTokens();
    } catch (err) {
      setTokensError(err instanceof ApiRequestError ? err.message : t.projectSettings.revokeError);
    }
  }

  async function handleArchive() {
    setArchiveError(null);
    setArchiving(true);
    try {
      await archiveProject(project.id);
      onChanged();
      onClose();
    } catch (err) {
      setArchiveError(err instanceof ApiRequestError ? err.message : t.projectSettings.archiveError);
    } finally {
      setArchiving(false);
    }
  }

  function handleCopyToken() {
    if (!revealedToken) return;
    navigator.clipboard?.writeText(revealedToken).then(
      () => {
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 1500);
      },
      () => {
        /* ignore clipboard errors */
      },
    );
  }

  function buildMcpConfig(token: string): string {
    const mcpUrl = `${mcpBaseUrl()}/mcp`;
    const config = {
      mcpServers: {
        [`my-planner-${project.name}`]: {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }

  function handleCopyConfig() {
    if (!revealedToken) return;
    navigator.clipboard?.writeText(buildMcpConfig(revealedToken)).then(
      () => {
        setCopyConfigFeedback(true);
        setTimeout(() => setCopyConfigFeedback(false), 1500);
      },
      () => {
        /* ignore clipboard errors */
      },
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.projectSettings.title}</h2>

        <section className="drawer-section">
          <h3>{t.projectSettings.general}</h3>
          <form className="drawer-inline-form" onSubmit={handleRename}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              aria-label={t.projectSettings.projectNameAria}
            />
            <button type="submit" disabled={renaming || !name.trim() || name === project.name}>
              {renaming ? t.projectSettings.saving : t.projectSettings.rename}
            </button>
          </form>
          {renameError && <p className="login-error">{renameError}</p>}

          <label htmlFor="project-group" className="field-label repo-label">
            {t.projectSettings.group}
          </label>
          <form className="drawer-inline-form" onSubmit={handleSaveGroup}>
            <input
              id="project-group"
              value={groupName}
              onChange={(e) => {
                setGroupName(e.target.value);
                setGroupSaved(false);
              }}
              placeholder={t.projectSettings.groupPlaceholder}
              maxLength={60}
              list="project-group-options"
              autoComplete="off"
            />
            <datalist id="project-group-options">
              {existingGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <button type="submit" disabled={savingGroup || groupName.trim() === (project.groupName ?? "")}>
              {savingGroup ? t.projectSettings.saving : t.projectSettings.groupSave}
            </button>
          </form>
          <p className="ai-hint">{t.projectSettings.groupHint}</p>
          {groupSaved && <p className="profile-saved">{t.projectSettings.groupSaved}</p>}
          {groupError && <p className="login-error">{groupError}</p>}

          <label htmlFor="project-repo" className="field-label repo-label">
            {t.projectSettings.repo}
          </label>
          <form className="drawer-inline-form" onSubmit={handleSaveRepo}>
            <input
              id="project-repo"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                setRepoSaved(false);
              }}
              placeholder={t.projectSettings.repoPlaceholder}
              maxLength={300}
              inputMode="url"
              autoComplete="off"
            />
            <button type="submit" disabled={savingRepo || repoUrl.trim() === (project.repoUrl ?? "")}>
              {savingRepo ? t.projectSettings.saving : t.projectSettings.repoSave}
            </button>
          </form>
          <p className="ai-hint">{t.projectSettings.repoHint}</p>
          {repoSaved && <p className="profile-saved">{t.projectSettings.repoSaved}</p>}
          {repoError && <p className="login-error">{repoError}</p>}
        </section>

        <ProjectStatusesSection projectId={project.id} onChanged={() => onStatusesChanged?.()} />

        {isAdmin && <AiRoutineSection project={project} />}

        <section className="drawer-section">
          <h3>{t.projectSettings.mcpTokens}</h3>
          <form className="drawer-inline-form" onSubmit={handleCreateToken}>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t.projectSettings.labelPlaceholder}
              maxLength={100}
            />
            <button type="submit" disabled={creatingToken}>
              {creatingToken ? t.projectSettings.creating : t.projectSettings.newToken}
            </button>
          </form>

          {revealedToken && (
            <div className="token-reveal">
              <p>
                {t.projectSettings.copyTokenWarning} <strong>{t.projectSettings.notShownAgain}</strong>
              </p>
              <div className="token-reveal-row">
                <code>{revealedToken}</code>
                <button type="button" onClick={handleCopyToken}>
                  {copyFeedback ? t.common.copied : t.common.copy}
                </button>
              </div>
              <div className="mcp-config-block">
                <p>{t.projectSettings.mcpConfigTitle}</p>
                <pre className="mcp-config-json">
                  <code>{buildMcpConfig(revealedToken)}</code>
                </pre>
                <button type="button" onClick={handleCopyConfig}>
                  {copyConfigFeedback ? t.common.copied : t.projectSettings.copyConfig}
                </button>
              </div>

              <button type="button" className="token-reveal-dismiss" onClick={() => setRevealedToken(null)}>
                {t.projectSettings.copiedDismiss}
              </button>
            </div>
          )}

          {tokensError && <p className="login-error">{tokensError}</p>}

          {tokens.length === 0 ? (
            <p className="drawer-empty">{t.projectSettings.noTokens}</p>
          ) : (
            <ul className="drawer-list">
              {tokens.map((tok) => (
                <li key={tok.id}>
                  <span>
                    {tok.label || t.projectSettings.noLabel} — {t.projectSettings.createdOn}{" "}
                    {formatDate(tok.createdAt)}{" "}
                    {tok.revokedAt ? (
                      <span className="token-status token-revoked">{t.projectSettings.revoked}</span>
                    ) : (
                      <span className="token-status token-active">{t.projectSettings.active}</span>
                    )}
                  </span>
                  {!tok.revokedAt && (
                    <div className="drawer-list-actions">
                      <button type="button" onClick={() => handleRevoke(tok.id)}>
                        {t.projectSettings.revoke}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="drawer-section">
          <h3>{t.projectSettings.dangerZone}</h3>
          {!confirmArchive ? (
            <button type="button" className="danger-button" onClick={() => setConfirmArchive(true)}>
              {t.projectSettings.archiveProject}
            </button>
          ) : (
            <div className="confirm-row">
              <span>{t.projectSettings.confirmArchiveText}</span>
              <div className="drawer-list-actions">
                <button type="button" onClick={() => setConfirmArchive(false)} disabled={archiving}>
                  {t.common.cancel}
                </button>
                <button type="button" className="danger-button" onClick={handleArchive} disabled={archiving}>
                  {archiving ? t.projectSettings.archiving : t.projectSettings.confirmArchive}
                </button>
              </div>
            </div>
          )}
          {archiveError && <p className="login-error">{archiveError}</p>}
        </section>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t.projectSettings.close}
          </button>
        </div>
      </div>
    </div>
  );
}
