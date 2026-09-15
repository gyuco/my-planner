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

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onChanged: () => void;
}

export function ProjectSettingsModal({ project, onClose, onChanged }: ProjectSettingsModalProps) {
  const [name, setName] = useState(project.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [tokens, setTokens] = useState<ProjectToken[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function loadTokens() {
    try {
      const list = await listProjectTokens(project.id);
      setTokens(list);
      setTokensError(null);
    } catch (err) {
      setTokensError(err instanceof ApiRequestError ? err.message : "Impossibile caricare i token");
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
      setRenameError(err instanceof ApiRequestError ? err.message : "Errore durante la rinomina");
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
      setTokensError(err instanceof ApiRequestError ? err.message : "Errore durante la creazione del token");
    } finally {
      setCreatingToken(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    if (!window.confirm("Revocare questo token? Non potrà più essere usato via MCP.")) return;
    try {
      await revokeProjectToken(project.id, tokenId);
      await loadTokens();
    } catch (err) {
      setTokensError(err instanceof ApiRequestError ? err.message : "Errore durante la revoca del token");
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
      setArchiveError(err instanceof ApiRequestError ? err.message : "Errore durante l'archiviazione");
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Impostazioni progetto</h2>

        <section className="drawer-section">
          <h3>Generali</h3>
          <form className="drawer-inline-form" onSubmit={handleRename}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              aria-label="Nome progetto"
            />
            <button type="submit" disabled={renaming || !name.trim() || name === project.name}>
              {renaming ? "Salvataggio..." : "Rinomina"}
            </button>
          </form>
          {renameError && <p className="login-error">{renameError}</p>}
        </section>

        <section className="drawer-section">
          <h3>Token MCP</h3>
          <form className="drawer-inline-form" onSubmit={handleCreateToken}>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Etichetta (opzionale)"
              maxLength={100}
            />
            <button type="submit" disabled={creatingToken}>
              {creatingToken ? "Creazione..." : "Nuovo token"}
            </button>
          </form>

          {revealedToken && (
            <div className="token-reveal">
              <p>
                Copia questo token ora: <strong>non verrà mostrato di nuovo.</strong>
              </p>
              <div className="token-reveal-row">
                <code>{revealedToken}</code>
                <button type="button" onClick={handleCopyToken}>
                  {copyFeedback ? "Copiato!" : "Copia"}
                </button>
              </div>
              <button type="button" className="token-reveal-dismiss" onClick={() => setRevealedToken(null)}>
                Ho copiato il token, chiudi
              </button>
            </div>
          )}

          {tokensError && <p className="login-error">{tokensError}</p>}

          {tokens.length === 0 ? (
            <p className="drawer-empty">Nessun token creato per questo progetto.</p>
          ) : (
            <ul className="drawer-list">
              {tokens.map((t) => (
                <li key={t.id}>
                  <span>
                    {t.label || "(senza etichetta)"} — creato il {new Date(t.createdAt).toLocaleDateString()}{" "}
                    {t.revokedAt ? (
                      <span className="token-status token-revoked">revocato</span>
                    ) : (
                      <span className="token-status token-active">attivo</span>
                    )}
                  </span>
                  {!t.revokedAt && (
                    <div className="drawer-list-actions">
                      <button type="button" onClick={() => handleRevoke(t.id)}>
                        Revoca
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="drawer-section">
          <h3>Zona pericolosa</h3>
          {!confirmArchive ? (
            <button type="button" className="danger-button" onClick={() => setConfirmArchive(true)}>
              Archivia progetto
            </button>
          ) : (
            <div className="confirm-row">
              <span>Confermi l'archiviazione? Il progetto sparirà dalla vista principale (reversibile).</span>
              <div className="drawer-list-actions">
                <button type="button" onClick={() => setConfirmArchive(false)} disabled={archiving}>
                  Annulla
                </button>
                <button type="button" className="danger-button" onClick={handleArchive} disabled={archiving}>
                  {archiving ? "Archiviazione..." : "Conferma archiviazione"}
                </button>
              </div>
            </div>
          )}
          {archiveError && <p className="login-error">{archiveError}</p>}
        </section>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
