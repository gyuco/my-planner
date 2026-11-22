import { useEffect, useState } from "react";
import type { AiRoutineConfig, Project } from "@my-planner/core";
import { ApiRequestError, getAiRoutine, removeAiRoutine, runAiRoutine, saveAiRoutine } from "../api";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { copyText } from "../lib/clipboard";

/**
 * Impostazioni progetto -> avvio automatico dei passi AI con una routine di
 * Claude Code (solo admin). Il token del trigger si scrive e basta: il server
 * non lo restituisce mai.
 */
export function AiRoutineSection({ project }: { project: Project }) {
  const { t, formatDateTime } = useI18n();
  const toast = useToast();
  const [config, setConfig] = useState<AiRoutineConfig | null>(null);
  const [routineId, setRoutineId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getAiRoutine(project.id)
      .then((c) => {
        setConfig(c);
        setRoutineId(c.routineId ?? "");
      })
      .catch(() => undefined);
  }, [project.id, project.repoUrl]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.aiRoutine.error);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const saved = await run(() => saveAiRoutine(project.id, { routineId: routineId.trim(), token: token.trim() || null }));
    if (saved) {
      setConfig(saved);
      setToken("");
      toast.success(t.aiRoutine.saved);
    }
  }

  async function handleRemove() {
    const cleared = await run(() => removeAiRoutine(project.id));
    if (cleared) {
      setConfig(cleared);
      setRoutineId("");
      setToken("");
      toast.success(t.aiRoutine.removed);
    }
  }

  async function handleRunNow() {
    const res = await run(() => runAiRoutine(project.id));
    if (!res) return;
    if (res.fired) toast.success(t.aiRoutine.fired.replace("{count}", String(res.taskIds.length)));
    else toast.error(t.aiRoutine.notFired.replace("{reason}", res.reason ?? "?"));
    setConfig(await getAiRoutine(project.id));
  }

  async function handleCopy() {
    if (config && (await copyText(config.prompt))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <section className="drawer-section ai-routine-section">
      <h3>
        {t.aiRoutine.title}{" "}
        <span className={`token-status ${config?.configured ? "token-active" : "token-revoked"}`}>
          {config?.configured ? t.aiRoutine.configured : t.aiRoutine.notConfigured}
        </span>
      </h3>
      <p className="ai-hint">{t.aiRoutine.intro}</p>
      {!project.repoUrl && <p className="push-notice">{t.aiRoutine.noRepo}</p>}
      <ol className="ai-routine-steps">
        <li>{t.aiRoutine.step1}</li>
        <li>{t.aiRoutine.step2}</li>
        <li>{t.aiRoutine.step3}</li>
      </ol>

      {config && (
        <div className="mcp-config-block">
          <p>{t.aiRoutine.prompt}</p>
          <pre className="mcp-config-json">
            <code>{config.prompt}</code>
          </pre>
          <button type="button" onClick={handleCopy}>
            {copied ? t.aiRoutine.copied : t.aiRoutine.copy}
          </button>
        </div>
      )}

      <form className="ai-routine-form" onSubmit={handleSave}>
        <label>
          {t.aiRoutine.routineId}
          <input
            value={routineId}
            onChange={(e) => setRoutineId(e.target.value)}
            placeholder={t.aiRoutine.routineIdPlaceholder}
            autoComplete="off"
            maxLength={100}
            required
          />
        </label>
        <label>
          {t.aiRoutine.token}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={config?.configured ? t.aiRoutine.tokenKeep : t.aiRoutine.tokenPlaceholder}
            autoComplete="off"
            maxLength={500}
          />
        </label>
        <div className="drawer-list-actions">
          <button type="submit" disabled={busy || !routineId.trim()}>
            {busy ? t.aiRoutine.saving : t.aiRoutine.save}
          </button>
          {config?.configured && (
            <>
              <button type="button" onClick={handleRunNow} disabled={busy}>
                {busy ? t.aiRoutine.running : t.aiRoutine.runNow}
              </button>
              <button type="button" className="danger-button" onClick={handleRemove} disabled={busy}>
                {t.aiRoutine.remove}
              </button>
            </>
          )}
        </div>
      </form>

      {config?.lastFiredAt && (
        <p className="ai-hint">
          {t.aiRoutine.lastFired}: {formatDateTime(config.lastFiredAt)}
          {config.lastSessionUrl && (
            <>
              {" · "}
              <a href={config.lastSessionUrl} target="_blank" rel="noreferrer">
                {t.aiRoutine.openSession}
              </a>
            </>
          )}
        </p>
      )}
      {config?.lastError && (
        <p className="ai-failure">
          {t.aiRoutine.lastError}: {config.lastError}
        </p>
      )}
      {error && <p className="login-error">{error}</p>}
    </section>
  );
}
