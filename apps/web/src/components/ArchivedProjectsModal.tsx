import { useEffect, useState } from "react";
import type { Project } from "@my-planner/core";
import { ApiRequestError, listProjects, unarchiveProject } from "../api";

interface ArchivedProjectsModalProps {
  onClose: () => void;
  onChanged: () => void;
}

export function ArchivedProjectsModal({ onClose, onChanged }: ArchivedProjectsModalProps) {
  const [archived, setArchived] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function load() {
    try {
      const all = await listProjects(true);
      setArchived(all.filter((p) => p.archived));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Impossibile caricare i progetti archiviati");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRestore(projectId: string) {
    setRestoringId(projectId);
    try {
      await unarchiveProject(projectId);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante il ripristino");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Progetti archiviati</h2>
        {error && <p className="login-error">{error}</p>}
        {archived.length === 0 ? (
          <p className="drawer-empty">Nessun progetto archiviato.</p>
        ) : (
          <ul className="drawer-list">
            {archived.map((p) => (
              <li key={p.id}>
                <span>{p.name}</span>
                <div className="drawer-list-actions">
                  <button type="button" onClick={() => handleRestore(p.id)} disabled={restoringId === p.id}>
                    {restoringId === p.id ? "Ripristino..." : "Ripristina"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
