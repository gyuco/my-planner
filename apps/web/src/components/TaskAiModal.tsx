import { useEffect, useState } from "react";
import type { Task } from "@my-planner/core";
import { ApiRequestError, getTask } from "../api";
import { useI18n } from "../i18n";
import { XIcon } from "./Icons";
import { TaskAiSection } from "./TaskAiSection";

interface TaskAiModalProps {
  taskId: string;
  /** Titolo mostrato subito, prima che arrivi il task completo. */
  taskTitle?: string;
  /** Progetto con routine configurata: abilita "Apri sessione Claude su questa task". */
  claudeSessionProjectId?: string | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

/**
 * Gestione AI di un task in una modal a parte, apribile dalla card della
 * board senza aprire il task e dal drawer. Solo admin: il chiamante la
 * monta solo per loro e il server rifiuta comunque PUT /tasks/:id/ai agli
 * altri ruoli.
 */
export function TaskAiModal({ taskId, taskTitle, claudeSessionProjectId = null, onClose, onSaved }: TaskAiModalProps) {
  const { t } = useI18n();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTask(null);
    setError(null);
    getTask(taskId)
      .then((loaded) => {
        if (!cancelled) setTask(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiRequestError ? err.message : t.taskAi.loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay modal-overlay-above-drawer" onClick={onClose}>
      <div
        className="modal task-ai-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-ai-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="task-ai-modal-head">
          <h2 id="task-ai-modal-title">{t.taskAi.title}</h2>
          <button type="button" className="icon-button" onClick={onClose} title={t.taskDrawer.closeTitle} aria-label={t.taskDrawer.closeTitle}>
            <XIcon />
          </button>
        </div>
        <p className="profile-hint task-ai-modal-task">{task?.title ?? taskTitle}</p>
        {error && <p className="login-error" role="alert">{error}</p>}
        {!task && !error && <p className="ai-hint">{t.taskDrawer.loading}</p>}
        {task && (
          <TaskAiSection
            task={task}
            isAdmin
            hideTitle
            claudeSessionProjectId={claudeSessionProjectId}
            onSaved={(updated) => {
              setTask(updated);
              onSaved(updated);
            }}
          />
        )}
      </div>
    </div>
  );
}
