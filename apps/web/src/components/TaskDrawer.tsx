import { useCallback, useEffect, useState } from "react";
import { FIBONACCI_COMPLEXITY } from "@my-planner/core";
import type { Attachment, Comment, Task, TaskComplexity, TaskPriority } from "@my-planner/core";
import {
  ApiRequestError,
  addComment,
  addDependency,
  createSubtask,
  deleteAttachment,
  downloadAttachment,
  getTask,
  listAttachments,
  listComments,
  listTasks,
  moveTask,
  removeDependency,
  updateTask,
  uploadAttachment,
} from "../api";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

interface TaskDrawerProps {
  taskId: string;
  projectId: string;
  onClose: () => void;
  /** Chiamato dopo modifiche rilevanti (stato subtask, dipendenze) per rifare il refresh della board. */
  onChanged: () => void;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function TaskDrawer({ taskId, projectId, onClose, onChanged }: TaskDrawerProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [complexity, setComplexity] = useState<TaskComplexity | "">("");
  const [tagsInput, setTagsInput] = useState("");
  const [dueDate, setDueDate] = useState("");

  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [selectedBlocker, setSelectedBlocker] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, c, a, tasks] = await Promise.all([
        getTask(taskId),
        listComments(taskId),
        listAttachments(taskId),
        listTasks(projectId),
      ]);
      setTask(t);
      setTitle(t.title);
      setDescription(t.description);
      setPriority(t.priority);
      setComplexity(t.complexity ?? "");
      setTagsInput(t.tags.join(", "));
      setDueDate(toDateInputValue(t.dueDate));
      setComments(c);
      setAttachments(a);
      setProjectTasks(tasks.filter((pt) => pt.id !== taskId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Impossibile caricare il task");
    } finally {
      setLoading(false);
    }
  }, [taskId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveFields() {
    if (!task) return;
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const updated = await updateTask(taskId, {
        title,
        description,
        priority,
        complexity: complexity === "" ? null : complexity,
        tags,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      });
      setTask((prev) => (prev ? { ...prev, ...updated } : updated));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante il salvataggio");
    }
  }

  async function handleToggleSubtaskDone(subtaskId: string, done: boolean) {
    try {
      await moveTask(subtaskId, done ? "done" : "draft");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante l'aggiornamento del subtask");
    }
  }

  async function handleAddSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;
    try {
      await createSubtask(taskId, { title: newSubtaskTitle.trim() });
      setNewSubtaskTitle("");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante la creazione del subtask");
    }
  }

  async function handleAddDependency() {
    if (!selectedBlocker) return;
    try {
      await addDependency(taskId, selectedBlocker);
      setSelectedBlocker("");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante l'aggiunta della dipendenza");
    }
  }

  async function handleRemoveDependency(blockedByTaskId: string) {
    try {
      await removeDependency(taskId, blockedByTaskId);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante la rimozione della dipendenza");
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const c = await addComment(taskId, newComment.trim());
      setComments((prev) => [...prev, c]);
      setNewComment("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante l'aggiunta del commento");
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const attachment = await uploadAttachment(taskId, file);
      setAttachments((prev) => [...prev, attachment]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante l'upload dell'allegato");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDownload(attachment: Attachment) {
    try {
      await downloadAttachment(attachment.id, attachment.fileName);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante il download");
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    try {
      await deleteAttachment(attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Errore durante l'eliminazione dell'allegato");
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const availableBlockers = projectTasks.filter(
    (t) => !(task?.blockedBy ?? []).some((d) => d.blockedByTaskId === t.id)
  );

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>Dettaglio task</h2>
          <button className="icon-button" onClick={onClose} title="Chiudi">
            &times;
          </button>
        </div>

        {loading && <p>Caricamento...</p>}
        {error && (
          <div className="board-error" role="alert">
            {error}
            <button onClick={() => setError(null)}>&times;</button>
          </div>
        )}

        {!loading && task && (
          <div className="drawer-body">
            <section className="drawer-section">
              <label>
                Titolo
                <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveFields} maxLength={300} />
              </label>
              <label>
                Descrizione (markdown)
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={saveFields}
                  rows={4}
                />
              </label>
              <div className="modal-row">
                <label>
                  Priorità
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    onBlur={saveFields}
                  >
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
                    onChange={(e) =>
                      setComplexity(e.target.value === "" ? "" : (Number(e.target.value) as TaskComplexity))
                    }
                    onBlur={saveFields}
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
                  <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} onBlur={saveFields} />
                </label>
                <label>
                  Scadenza
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} onBlur={saveFields} />
                </label>
              </div>
              <button type="button" onClick={saveFields}>
                Salva
              </button>
            </section>

            <section className="drawer-section">
              <h3>Subtask</h3>
              <ul className="drawer-list">
                {(task.subtasks ?? []).map((s) => (
                  <li key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={s.status === "done"}
                        onChange={(e) => handleToggleSubtaskDone(s.id, e.target.checked)}
                      />
                      {s.title}
                    </label>
                  </li>
                ))}
                {(task.subtasks ?? []).length === 0 && <li className="drawer-empty">Nessun subtask</li>}
              </ul>
              <form onSubmit={handleAddSubtask} className="drawer-inline-form">
                <input
                  placeholder="Nuovo subtask"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                />
                <button type="submit">Aggiungi</button>
              </form>
            </section>

            <section className="drawer-section">
              <h3>Dipendenze</h3>
              <h4>Bloccata da</h4>
              <ul className="drawer-list">
                {(task.blockedBy ?? []).map((d) => {
                  const blockerTask = projectTasks.find((t) => t.id === d.blockedByTaskId);
                  const resolved = blockerTask?.status === "done";
                  return (
                    <li key={d.blockedByTaskId}>
                      <span className={resolved ? "dep-resolved" : "dep-open"}>
                        {resolved ? "✓" : "●"} {blockerTask?.title ?? d.blockedByTaskId}
                      </span>
                      <button type="button" onClick={() => handleRemoveDependency(d.blockedByTaskId)}>
                        Rimuovi
                      </button>
                    </li>
                  );
                })}
                {(task.blockedBy ?? []).length === 0 && <li className="drawer-empty">Nessun bloccante</li>}
              </ul>
              <div className="drawer-inline-form">
                <select value={selectedBlocker} onChange={(e) => setSelectedBlocker(e.target.value)}>
                  <option value="">Seleziona task bloccante...</option>
                  {availableBlockers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={handleAddDependency} disabled={!selectedBlocker}>
                  Aggiungi
                </button>
              </div>

              <h4>Blocca</h4>
              <ul className="drawer-list">
                {(task.blocking ?? []).map((d) => (
                  <li key={d.taskId}>{projectTasks.find((t) => t.id === d.taskId)?.title ?? d.taskId}</li>
                ))}
                {(task.blocking ?? []).length === 0 && <li className="drawer-empty">Non blocca nessun task</li>}
              </ul>
            </section>

            <section className="drawer-section">
              <h3>Commenti</h3>
              <ul className="drawer-list drawer-comments">
                {comments.map((c) => (
                  <li key={c.id}>
                    <div className="comment-date">{new Date(c.createdAt).toLocaleString()}</div>
                    <div>{c.body}</div>
                  </li>
                ))}
                {comments.length === 0 && <li className="drawer-empty">Nessun commento</li>}
              </ul>
              <form onSubmit={handleAddComment} className="drawer-inline-form">
                <input
                  placeholder="Aggiungi un commento"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
                <button type="submit">Invia</button>
              </form>
            </section>

            <section className="drawer-section">
              <h3>Allegati</h3>
              <ul className="drawer-list">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.fileName} <span className="attachment-size">({formatSize(a.size)})</span>
                    </span>
                    <span className="drawer-list-actions">
                      <button type="button" onClick={() => handleDownload(a)}>
                        Scarica
                      </button>
                      <button type="button" onClick={() => handleDeleteAttachment(a.id)}>
                        Elimina
                      </button>
                    </span>
                  </li>
                ))}
                {attachments.length === 0 && <li className="drawer-empty">Nessun allegato</li>}
              </ul>
              <input type="file" onChange={handleUpload} disabled={uploading} />
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
