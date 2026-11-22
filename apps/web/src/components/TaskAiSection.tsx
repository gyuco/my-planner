import { useEffect, useState } from "react";
import { AI_MAX_REJECTS, AI_NOTIFY_MODES, AI_STEPS, aiPendingStep, aiRunningStep, normalizeAiSteps } from "@my-planner/core";
import type { AiNotifyMode, AiStep, Task } from "@my-planner/core";
import { ApiRequestError, setTaskAi } from "../api";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { Link } from "react-router-dom";

interface TaskAiSectionProps {
  task: Task;
  isAdmin: boolean;
  onSaved: (task: Task) => void;
}

/**
 * Gestione AI del task nel drawer. L'admin la attiva, sceglie i passi
 * (triage da Draft a TODO, coder da TODO a Testing, reviewer da Testing a
 * Done) e quando essere avvisato. Gli altri utenti vedono solo lo stato,
 * e solo se la gestione AI e' attiva.
 */
export function TaskAiSection({ task, isAdmin, onSaved }: TaskAiSectionProps) {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const ai = task.ai;
  const [enabled, setEnabled] = useState(ai?.enabled ?? false);
  const [steps, setSteps] = useState<AiStep[]>(ai?.steps ?? []);
  const [notify, setNotify] = useState<AiNotifyMode>(ai?.notify ?? "end");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(task.ai?.enabled ?? false);
    setSteps(task.ai?.steps ?? []);
    setNotify(task.ai?.notify ?? "end");
    setError(null);
  }, [task.id, task.ai?.enabled, task.ai?.steps.join(","), task.ai?.notify]);

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
        <p className="ai-hint">{t.taskAi.readOnly}</p>
      </section>
    );
  }

  const unchanged =
    enabled === (ai?.enabled ?? false) &&
    steps.join(",") === (ai?.steps ?? []).join(",") &&
    notify === (ai?.notify ?? "end");

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
    setSaving(true);
    setError(null);
    try {
      const updated = await setTaskAi(task.id, { enabled, steps, notify });
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
      <h3>
        {t.taskAi.title}{" "}
        <Link className="guide-link" to="/guide#guide-use">
          {t.guide.open}
        </Link>
      </h3>
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
    </section>
  );
}
