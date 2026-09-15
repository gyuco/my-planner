import { useCallback, useEffect, useState } from "react";
import { FIBONACCI_COMPLEXITY } from "@my-planner/core";
import type { Attachment, Comment, Task, TaskComplexity, TaskPriority, TaskStatus } from "@my-planner/core";
import { renderMarkdown } from "../lib/markdown";
import {
  ApiRequestError,
  addComment,
  addDependency,
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
import { useI18n } from "../i18n";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUSES: TaskStatus[] = ["draft", "in_progress", "done"];

interface TaskDrawerProps {
  taskId: string;
  projectId: string;
  onClose: () => void;
  /** Chiamato dopo modifiche rilevanti (stato task, dipendenze) per rifare il refresh della board. */
  onChanged: () => void;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function TaskDrawer({ taskId, projectId, onClose, onChanged }: TaskDrawerProps) {
  const { t, formatDateTime } = useI18n();
  const STATUS_LABEL: Record<TaskStatus, string> = {
    draft: t.board.draft,
    in_progress: t.board.inProgress,
    done: t.board.done,
  };
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

  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [selectedBlocker, setSelectedBlocker] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);

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
      setEditingDescription(!t.description.trim());
      setComments(c);
      setAttachments(a);
      setProjectTasks(tasks.filter((pt) => pt.id !== taskId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.loadError);
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
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.saveError);
    }
  }

  async function handleChangeStatus(status: TaskStatus) {
    if (!task || status === task.status) return;
    setStatusError(null);
    setChangingStatus(true);
    try {
      const updated = await moveTask(taskId, status);
      setTask((prev) => (prev ? { ...prev, ...updated } : updated));
      onChanged();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "DEPENDENCY_BLOCKED") {
        setStatusError(err.message);
      } else {
        setStatusError(
          err instanceof ApiRequestError ? err.message : t.taskDrawer.statusChangeError,
        );
      }
    } finally {
      setChangingStatus(false);
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
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.addDependencyError);
    }
  }

  async function handleRemoveDependency(blockedByTaskId: string) {
    try {
      await removeDependency(taskId, blockedByTaskId);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.removeDependencyError);
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
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.commentError);
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
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.uploadError);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDownload(attachment: Attachment) {
    try {
      await downloadAttachment(attachment.id, attachment.fileName);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.downloadError);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    try {
      await deleteAttachment(attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.taskDrawer.deleteAttachmentError);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const availableBlockers = projectTasks.filter(
    (pt) => !(task?.blockedBy ?? []).some((d) => d.blockedByTaskId === pt.id)
  );

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>{t.taskDrawer.details}</h2>
          <button className="icon-button" onClick={onClose} title={t.taskDrawer.closeTitle}>
            &times;
          </button>
        </div>

        {loading && <p>{t.taskDrawer.loading}</p>}
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
                {t.taskDrawer.statusLabel}
                <select
                  value={task.status}
                  disabled={changingStatus}
                  onChange={(e) => handleChangeStatus(e.target.value as TaskStatus)}
                  aria-label={t.taskDrawer.changeStatusAria}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              {statusError && (
                <div className="board-error" role="alert">
                  {statusError}
                  <button onClick={() => setStatusError(null)}>&times;</button>
                </div>
              )}
              <label>
                {t.taskDrawer.titleLabel}
                <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveFields} maxLength={300} />
              </label>
              <div className="drawer-description">
                <div className="drawer-description-head">
                  <span className="field-label">{t.taskDrawer.descriptionLabel}</span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      if (editingDescription) saveFields();
                      setEditingDescription((v) => !v);
                    }}
                  >
                    {editingDescription ? t.taskDrawer.preview : t.taskDrawer.edit}
                  </button>
                </div>
                {editingDescription ? (
                  <textarea
                    className="drawer-description-editor"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={saveFields}
                    rows={10}
                    placeholder={t.taskDrawer.descriptionPlaceholder}
                    autoFocus
                  />
                ) : description.trim() ? (
                  <div
                    className="drawer-description-preview"
                    onClick={() => setEditingDescription(true)}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}
                  />
                ) : (
                  <div className="drawer-description-preview drawer-description-empty" onClick={() => setEditingDescription(true)}>
                    {t.taskDrawer.noDescription}
                  </div>
                )}
              </div>
              <div className="modal-row">
                <label>
                  {t.taskDrawer.priorityLabel}
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
                  {t.taskDrawer.complexityLabel}
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
                  {t.taskDrawer.tagsLabel}
                  <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} onBlur={saveFields} />
                </label>
                <label>
                  {t.taskDrawer.dueDateLabel}
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} onBlur={saveFields} />
                </label>
              </div>
              <button type="button" className="drawer-save-button" onClick={saveFields}>
                {t.taskDrawer.save}
              </button>
            </section>

            <section className="drawer-section">
              <h3>{t.taskDrawer.dependencies}</h3>
              <h4>{t.taskDrawer.blockedBy}</h4>
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
                        {t.taskDrawer.remove}
                      </button>
                    </li>
                  );
                })}
                {(task.blockedBy ?? []).length === 0 && <li className="drawer-empty">{t.taskDrawer.noBlockers}</li>}
              </ul>
              <div className="drawer-inline-form">
                <select value={selectedBlocker} onChange={(e) => setSelectedBlocker(e.target.value)}>
                  <option value="">{t.taskDrawer.selectBlockerPlaceholder}</option>
                  {availableBlockers.map((bt) => (
                    <option key={bt.id} value={bt.id}>
                      {bt.title}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={handleAddDependency} disabled={!selectedBlocker}>
                  {t.taskDrawer.add}
                </button>
              </div>

              <h4>{t.taskDrawer.blocking}</h4>
              <ul className="drawer-list">
                {(task.blocking ?? []).map((d) => (
                  <li key={d.taskId}>{projectTasks.find((t) => t.id === d.taskId)?.title ?? d.taskId}</li>
                ))}
                {(task.blocking ?? []).length === 0 && <li className="drawer-empty">{t.taskDrawer.notBlocking}</li>}
              </ul>
            </section>

            <section className="drawer-section">
              <h3>{t.taskDrawer.comments}</h3>
              <ul className="drawer-list drawer-comments">
                {comments.map((c) => (
                  <li key={c.id}>
                    <div className="comment-date">{formatDateTime(c.createdAt)}</div>
                    <div>{c.body}</div>
                  </li>
                ))}
                {comments.length === 0 && <li className="drawer-empty">{t.taskDrawer.noComments}</li>}
              </ul>
              <form onSubmit={handleAddComment} className="drawer-inline-form">
                <input
                  placeholder={t.taskDrawer.commentPlaceholder}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
                <button type="submit">{t.taskDrawer.send}</button>
              </form>
            </section>

            <section className="drawer-section">
              <h3>{t.taskDrawer.attachments}</h3>
              <ul className="drawer-list">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.fileName} <span className="attachment-size">({formatSize(a.size)})</span>
                    </span>
                    <span className="drawer-list-actions">
                      <button type="button" onClick={() => handleDownload(a)}>
                        {t.taskDrawer.download}
                      </button>
                      <button type="button" onClick={() => handleDeleteAttachment(a.id)}>
                        {t.taskDrawer.delete}
                      </button>
                    </span>
                  </li>
                ))}
                {attachments.length === 0 && <li className="drawer-empty">{t.taskDrawer.noAttachments}</li>}
              </ul>
              <input type="file" onChange={handleUpload} disabled={uploading} />
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
