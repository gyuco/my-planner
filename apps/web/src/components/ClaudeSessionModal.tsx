import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiRequestError, startClaudeSession } from "../api";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";

interface ClaudeSessionModalProps {
  projectId: string;
  /** Se presente, la sessione lavora su questo task. */
  taskId?: string;
  /** Titolo del task, mostrato sotto l'intestazione. */
  taskTitle?: string;
  onClose: () => void;
}

/**
 * Avvia una sessione interattiva di Claude Code con la routine del progetto
 * (solo admin). La conversazione avviene su claude.ai: qui si scrive solo la
 * richiesta iniziale e si apre il link della sessione.
 */
export function ClaudeSessionModal({ projectId, taskId, taskTitle, onClose }: ClaudeSessionModalProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<{ sessionUrl: string | null } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = message.trim();

  useEffect(() => {
    textareaRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function handleSubmit() {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await startClaudeSession(projectId, { message: trimmed, ...(taskId ? { taskId } : {}) });
      setStarted(res);
      // I blocchi dei popup possono fermarlo: il link nel dialog resta la via sicura.
      if (res.sessionUrl) window.open(res.sessionUrl, "_blank", "noreferrer");
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t.claudeSession.error);
    } finally {
      setBusy(false);
    }
  }

  // Portale sul body: il dialog si apre anche dal drawer del task, che ha un proprio contesto di impilamento.
  return createPortal(
    <div className="modal-overlay modal-overlay-above-drawer" onClick={busy ? undefined : onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-session-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <h2 id="claude-session-title">{t.claudeSession.title}</h2>
        {taskTitle && <p className="profile-hint send-back-task">{taskTitle}</p>}
        {started ? (
          <>
            <p role="status">{started.sessionUrl ? t.claudeSession.started : t.claudeSession.noUrl}</p>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                {t.common.close}
              </button>
              {started.sessionUrl && (
                <a className="modal-primary-link" href={started.sessionUrl} target="_blank" rel="noreferrer">
                  {t.claudeSession.openLink}
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <label>
              {t.claudeSession.label}
              <textarea
                ref={textareaRef}
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.claudeSession.placeholder}
                maxLength={4000}
                required
              />
            </label>
            <p className="profile-hint">{t.claudeSession.hint}</p>
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={busy}>
                {t.common.cancel}
              </button>
              <button type="submit" disabled={busy || !trimmed} aria-busy={busy}>
                {busy ? t.claudeSession.starting : t.claudeSession.submit}
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}
