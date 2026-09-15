import { useState } from "react";
import { FIBONACCI_COMPLEXITY } from "@my-planner/core";
import type { TaskPriority, TaskComplexity } from "@my-planner/core";
import { ApiRequestError, createTask } from "../api";

interface CreateTaskModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export function CreateTaskModal({ projectId, onClose, onCreated }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [complexity, setComplexity] = useState<TaskComplexity | "">("");
  const [tagsInput, setTagsInput] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await createTask(projectId, {
        title,
        description,
        priority,
        complexity: complexity === "" ? null : complexity,
        tags,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante la creazione del task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Nuovo task</h2>

        <label>
          Titolo
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={300} />
        </label>

        <label>
          Descrizione (markdown)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>

        <div className="modal-row">
          <label>
            Priorità
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label>
            Complessità
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value === "" ? "" : (Number(e.target.value) as TaskComplexity))}
            >
              <option value="">—</option>
              {FIBONACCI_COMPLEXITY.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="modal-row">
          <label>
            Tag (separati da virgola)
            <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
          </label>

          <label>
            Scadenza
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>

        {error && <p className="login-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button type="submit" disabled={saving || !title.trim()}>
            {saving ? "Creazione..." : "Crea task"}
          </button>
        </div>
      </form>
    </div>
  );
}
