import { useEffect, useState } from "react";
import type { Project, ProjectToken } from "@my-planner/core";
import {
  ApiRequestError,
  archiveProject,
  createProjectToken,
  listProjectTokens,
  renameProject,
  revokeProjectToken,
} from "../api";
import { useI18n } from "../i18n";

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onChanged: () => void;
}

export function ProjectSettingsModal({ project, onClose, onChanged }: ProjectSettingsModalProps) {
  const { t, formatDate } = useI18n();
  const [name, setName] = useState(project.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

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
    // Su Cloudflare Worker e MCP HTTP condividono lo stesso host (nessuna
    // porta 3100): si configura la base via VITE_MCP_HTTP_BASE_URL in build
    // (vedi README §Cloudflare). Default: stesso host della UI, porta 3100,
    // coerente con lo stack Node/Docker.
    const configuredBase = import.meta.env.VITE_MCP_HTTP_BASE_URL;
    const mcpUrl = configuredBase
      ? `${configuredBase.replace(/\/$/, "")}/mcp`
      : `${window.location.protocol}//${window.location.hostname}:3100/mcp`;
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
        </section>

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
