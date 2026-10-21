import { useMemo, useRef, useState } from "react";
import { FIBONACCI_COMPLEXITY } from "@my-planner/core";
import type { TaskPriority, TaskComplexity, TaskType } from "@my-planner/core";
import { ApiRequestError, createTask, uploadAttachment } from "../api";
import { useI18n } from "../i18n";
import { TaskTypePicker } from "./TaskTypePicker";
import { AssigneeSelect } from "./AssigneeSelect";

interface CreateTaskModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreateTaskModal({ projectId, onClose, onCreated }: CreateTaskModalProps) {
  const { t } = useI18n();
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("feature");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [complexity, setComplexity] = useState<TaskComplexity | "">("");
  const [tagsInput, setTagsInput] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quanti parametri avanzati sono stati personalizzati: mostrato come badge
  // accanto al toggle, così restano "fuori dai piedi" ma non invisibili.
  const advancedCount = useMemo(() => {
    let count = 0;
    if (priority !== "medium") count += 1;
    if (complexity !== "") count += 1;
    if (tagsInput.trim()) count += 1;
    if (dueDate) count += 1;
    return count;
  }, [priority, complexity, tagsInput, dueDate]);

  function addFiles(list: FileList | File[]) {
    const selected = Array.from(list);
    if (selected.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const unique = selected.filter((f) => !seen.has(`${f.name}:${f.size}:${f.lastModified}`));
      return [...prev, ...unique];
    });
  }

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files ?? []);
    e.target.value = "";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragging) setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Ignora il passaggio del cursore tra i figli della dropzone.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function handleRemoveFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const task = await createTask(projectId, {
        title,
        description,
        type,
        priority,
        complexity: complexity === "" ? null : complexity,
        tags,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        assigneeId,
      });

      onCreated();

      if (files.length > 0) {
        const results = await Promise.allSettled(files.map((file) => uploadAttachment(task.id, file)));
        if (results.some((r) => r.status === "rejected")) {
          setError(t.createTask.attachmentUploadError);
          return;
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.createTask.createError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{t.createTask.title}</h2>

        <div className="field">
          <span className="field-label">{t.taskType.label}</span>
          <TaskTypePicker value={type} onChange={setType} />
        </div>

        <label>
          {t.createTask.titleLabel}
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={300} />
        </label>

        <label>
          {t.createTask.descriptionLabel}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>

        <AssigneeSelect
          projectId={projectId}
          value={assigneeId}
          onChange={setAssigneeId}
        />

        <div className={`advanced-section${advancedOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advancedOpen}
            aria-controls="create-task-advanced"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <svg className="advanced-chevron" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t.createTask.advancedSettings}</span>
            {advancedCount > 0 && <span className="advanced-count">{advancedCount}</span>}
            <span className="advanced-hint">{t.createTask.advancedHint}</span>
          </button>

          <div id="create-task-advanced" className="advanced-panel" hidden={!advancedOpen}>
            <div className="modal-row">
              <label>
                {t.createTask.priorityLabel}
                <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                {t.createTask.complexityLabel}
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
                {t.createTask.tagsLabel}
                <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
              </label>

              <label>
                {t.createTask.dueDateLabel}
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <div className="file-upload">
          <span className="field-label">{t.createTask.attachmentsLabel}</span>

          <div
            className={`file-dropzone${dragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={t.createTask.attachDropTitle}
            onClick={openFilePicker}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openFilePicker();
              }
            }}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" multiple hidden onChange={handleFilesSelected} />
            <svg className="file-dropzone-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="file-dropzone-title">
              {dragging ? t.createTask.attachDropActive : t.createTask.attachDropTitle}
            </span>
            <span className="file-dropzone-hint">{t.createTask.attachDropHint}</span>
          </div>

          {files.length > 0 && (
            <ul className="file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                  <span className="file-list-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                      <path d="M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="file-list-info">
                    <span className="file-list-name">{file.name}</span>
                    <span className="file-list-size">{formatSize(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    className="file-list-remove"
                    onClick={() => handleRemoveFile(index)}
                    aria-label={`${t.createTask.removeFile}: ${file.name}`}
                    title={t.createTask.removeFile}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="login-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={saving}>
            {t.createTask.cancel}
          </button>
          <button type="submit" disabled={saving || !title.trim()}>
            {saving ? t.createTask.creating : t.createTask.create}
          </button>
        </div>
      </form>
    </div>
  );
}
