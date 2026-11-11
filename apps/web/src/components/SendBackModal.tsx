import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { BoardTask } from "./TaskCard";

interface SendBackModalProps {
  task: BoardTask;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Il messaggio viene salvato come commento sul task. */
  onConfirm: (message: string) => void;
}

/**
 * Rimanda un task da Testing a In progress: il motivo e' obbligatorio e
 * finisce nei commenti del task, cosi' chi lo riprende sa cosa sistemare.
 */
export function SendBackModal({ task, busy, error, onCancel, onConfirm }: SendBackModalProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = message.trim();

  useEffect(() => {
    textareaRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-back-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !busy) onConfirm(trimmed);
        }}
      >
        <h2 id="send-back-title">{t.board.sendBackTitle}</h2>
        <p className="profile-hint send-back-task">{task.title}</p>
        <label>
          {t.board.sendBackLabel}
          <textarea
            ref={textareaRef}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.board.sendBackPlaceholder}
            maxLength={10000}
            required
          />
        </label>
        <p className="profile-hint">{t.board.sendBackHint}</p>
        {error && <p className="login-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            {t.board.cancel}
          </button>
          <button type="submit" disabled={busy || !trimmed}>
            {busy ? t.board.sendingBack : t.board.sendBackConfirm}
          </button>
        </div>
      </form>
    </div>
  );
}
