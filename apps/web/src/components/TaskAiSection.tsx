import { useEffect, useState } from "react";
import { AI_MAX_REJECTS, AI_NOTE_MAX_LENGTH, AI_NOTIFY_MODES, AI_STEPS, aiPendingStep, aiRunningStep, normalizeAiSteps } from "@my-planner/core";
import type { AiNotifyMode, AiStep, Task } from "@my-planner/core";
import { ApiRequestError, setTaskAi } from "../api";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { Link } from "react-router-dom";
import { ClaudeSessionModal } from "./ClaudeSessionModal";

interface TaskAiSectionProps {
  task: Task;
  isAdmin: boolean;
  /** Progetto con routine configurata: l'admin puo' aprire una sessione Claude su questo task. */
  claudeSessionProjectId?: string | null;
  /** Nella modal il titolo e' gia' nell'intestazione. */
  hideTitle?: boolean;
  onSaved: (task: Task) => void;
}

/**
 * Gestione AI del task nel drawer. L'admin la attiva, sceglie i passi
 * (triage da Draft a TODO, coder da TODO a Testing, reviewer da Testing a
 * Done) e quando essere avvisato. Gli altri utenti vedono solo lo stato,
 * e solo se la gestione AI e' attiva.
 */
export function TaskAiSection({ task, isAdmin, claudeSessionProjectId = null, hideTitle = false, onSaved }: TaskAiSectionProps) {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const ai = task.ai;
  const [enabled, setEnabled] = useState(ai?.enabled ?? false);
  const [steps, setSteps] = useState<AiStep[]>(ai?.steps ?? []);
  const [notify, setNotify] = useState<AiNotifyMode>(ai?.notify ?? "end");
  // Nota per l'agente: resta nello stato anche se si spegne la checkbox, e si
  // salva comunque (pronta per quando la gestione AI si riattiva).
  const [note, setNote] = useState(ai?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claudeSessionOpen, setClaudeSessionOpen] = useState(false);

  useEffect(() => {
    setEnabled(task.ai?.enabled ?? false);
    setSteps(task.ai?.steps ?? []);
    setNotify(task.ai?.notify ?? "end");
    setNote(task.ai?.note ?? "");
    setError(null);
  }, [task.id, task.ai?.enabled, task.ai?.steps.join(","), task.ai?.notify, task.ai?.note]);

  const pending = aiPendingStep(task);
  const pendingText = pending ? t.taskAi.pending.replace("{step}", t.taskAi.step[pending]) : t.taskAi.noPending;
  const running = aiRunningStep(task);
  const runningText =
    running && ai?.running
      ? t.taskAi.running
          .replace("{step}", t.taskAi.step[running])
          .replace("{minutes}", String(Math.max(1, Math.round((Date.now() - new Date(ai.running.startedAt).getTime()) / 60000))))
      : null;
  const failure = ai?.enabled ? ai.failure : null;
  const rejectCount = ai?.rejectCount ?? 0;

  // Stato dell'esecuzione (passo in corso, rimandi, percorso fermato): uguale per admin e manager.
  const runState = (
    <>
      {runningText && <p className="ai-running">🤖 {runningText}</p>}
      {rejectCount > 0 && (
        <p className="ai-hint">{t.taskAi.rejects.replace("{count}", String(rejectCount)).replace("{max}", String(AI_MAX_REJECTS))}</p>
      )}
      {failure && (
        <p className="ai-failure" role="status">
          {t.taskAi.failed.replace("{reason}", failure.reason)}
        </p>
      )}
    </>
  );

  if (!isAdmin) {
    if (!ai?.enabled) return null;
    return (
      <section className="drawer-section ai-section" aria-label={t.taskAi.title}>
        <h3>{t.taskAi.title}</h3>
        <p className="ai-summary">
          {ai.steps.map((s) => t.taskAi.step[s]).join(" → ")} · {t.taskAi.notifyMode[ai.notify]}
        </p>
        {!failure && !runningText && <p className="ai-pending">{pendingText}</p>}
        {runState}
        {ai.note && (
          <div className="ai-note-readonly">
            <span className="field-label">{t.taskAi.noteLabel}</span>
            <p className="ai-note-text">{ai.note}</p>
          </div>
        )}
        <p className="ai-hint">{t.taskAi.readOnly}</p>
      </section>
    );
  }

  const unchanged =
    enabled === (ai?.enabled ?? false) &&
    steps.join(",") === (ai?.steps ?? []).join(",") &&
    notify === (ai?.notify ?? "end") &&
    note.trim() === (ai?.note ?? "");
  const noteTooLong = note.trim().length > AI_NOTE_MAX_LENGTH;

  function toggleStep(step: AiStep, on: boolean) {
    setSteps((prev) => normalizeAiSteps(on ? [...prev, step] : prev.filter((s) => s !== step)));
    setError(null);
  }

  async function handleResume() {
    if (!ai) return;
    setSaving(true);
    setError(null);
    try {
      // Salvare di nuovo la configurazione azzera fallimento, blocco e rimandi.
      const updated = await setTaskAi(task.id, { enabled: true, steps: ai.steps, notify: ai.notify });
      onSaved(updated);
      toast.success(t.taskAi.resumed);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.taskAi.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (enabled && steps.length === 0) {
      setError(t.taskAi.needStep);
      return;
    }
    if (noteTooLong) {
      setError(t.taskAi.noteTooLong.replace("{max}", String(AI_NOTE_MAX_LENGTH)));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await setTaskAi(task.id, { enabled, steps, notify, note: note.trim() || null });
      onSaved(updated);
      toast.success(t.taskAi.saved);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.taskAi.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="drawer-section ai-section" aria-label={t.taskAi.title}>
      {hideTitle ? (
        <Link className="guide-link" to="/guide#guide-use">
          {t.guide.open}
        </Link>
      ) : (
        <h3>
          {t.taskAi.title}{" "}
          <Link className="guide-link" to="/guide#guide-use">
            {t.guide.open}
          </Link>
        </h3>
      )}
      <label className="ai-option ai-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setError(null);
          }}
        />
        <span>{t.taskAi.enable}</span>
      </label>

      {enabled && (
        <>
          <fieldset className="ai-fieldset">
            <legend className="field-label">{t.taskAi.steps}</legend>
            {AI_STEPS.map((step) => (
              <label key={step} className="ai-option">
                <input type="checkbox" checked={steps.includes(step)} onChange={(e) => toggleStep(step, e.target.checked)} />
                <span>
                  <strong>{t.taskAi.step[step]}</strong> <span className="ai-hint">{t.taskAi.stepHint[step]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="ai-fieldset">
            <legend className="field-label">{t.taskAi.notify}</legend>
            {AI_NOTIFY_MODES.map((mode) => (
              <label key={mode} className="ai-option">
                <input
                  type="radio"
                  name={`ai-notify-${task.id}`}
                  value={mode}
                  checked={notify === mode}
                  onChange={() => setNotify(mode)}
                />
                <span>{t.taskAi.notifyMode[mode]}</span>
              </label>
            ))}
          </fieldset>

          <div className="ai-note-field">
            <label className="field-label" htmlFor={`ai-note-${task.id}`}>
              {t.taskAi.noteLabel}
            </label>
            <textarea
              id={`ai-note-${task.id}`}
              value={note}
              rows={5}
              maxLength={AI_NOTE_MAX_LENGTH}
              placeholder={t.taskAi.notePlaceholder}
              aria-describedby={`ai-note-hint-${task.id}`}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
            />
            <span className="ai-note-meta">
              <span id={`ai-note-hint-${task.id}`} className="ai-hint">
                {t.taskAi.noteHint}
              </span>
              <span className={`ai-hint ai-note-count${noteTooLong ? " ai-note-count-over" : ""}`}>
                {t.taskAi.noteCount.replace("{count}", String(note.length)).replace("{max}", String(AI_NOTE_MAX_LENGTH))}
              </span>
            </span>
          </div>
        </>
      )}

      {ai?.enabled && (
        <p className="ai-pending">
          {failure || runningText ? null : <>{pendingText} · </>}
          {ai.watcherName && t.taskAi.watcher.replace("{name}", ai.watcherName)}
        </p>
      )}
      {ai?.enabled && runState}
      {ai?.enabled && ai.dispatch?.sessionUrl && (
        <p className="ai-hint">
          🤖 {t.taskAi.session}:{" "}
          <a href={ai.dispatch.sessionUrl} target="_blank" rel="noreferrer">
            {t.taskAi.sessionAt.replace("{date}", formatDateTime(ai.dispatch.at))}
          </a>
        </p>
      )}
      {failure && (
        <button type="button" onClick={handleResume} disabled={saving}>
          {t.taskAi.resume}
        </button>
      )}
      {!enabled && !ai?.enabled && <p className="ai-hint">{t.taskAi.disabled}</p>}
      {error && <p className="login-error" role="alert">{error}</p>}

      <button type="button" onClick={handleSave} disabled={saving || unchanged} aria-busy={saving}>
        {saving ? t.taskAi.saving : t.taskAi.save}
      </button>

      {claudeSessionProjectId && (
        <>
          <button
            type="button"
            className="ai-session-button"
            onClick={() => setClaudeSessionOpen(true)}
            title={t.claudeSession.openTitle}
          >
            {t.claudeSession.openForTask}
          </button>
          {claudeSessionOpen && (
            <ClaudeSessionModal
              projectId={claudeSessionProjectId}
              taskId={task.id}
              taskTitle={task.title}
              onClose={() => setClaudeSessionOpen(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
