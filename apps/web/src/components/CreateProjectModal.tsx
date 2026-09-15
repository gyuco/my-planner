import { useState } from "react";
import { ApiRequestError, createProject } from "../api";
import { useI18n } from "../i18n";

interface CreateProjectModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const { t } = useI18n();
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
      setError(err instanceof ApiRequestError ? err.message : t.createProject.createError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t.createProject.title}</h2>
        <label>
          {t.createProject.nameLabel}
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={200} />
        </label>
        {error && <p className="login-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            {t.createProject.cancel}
          </button>
          <button type="submit" disabled={saving || !name.trim()}>
            {saving ? t.createProject.creating : t.createProject.create}
          </button>
        </div>
      </form>
    </div>
  );
}
