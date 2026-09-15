import { useState } from "react";
import { ApiRequestError, createProject } from "../api";

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await createProject(name);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante la creazione del progetto");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Nuovo progetto</h2>
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={200} />
        </label>
        {error && <p className="login-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Creazione..." : "Crea progetto"}
          </button>
        </div>
      </form>
    </div>
  );
}
