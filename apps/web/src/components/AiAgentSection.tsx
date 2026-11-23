import { useEffect, useState } from "react";
import type { AgentConfigView, Project } from "@my-planner/core";
import { ApiRequestError, getAgentConfig, removeAgentConfig, saveAgentConfig } from "../api";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { mcpBaseUrl } from "../lib/mcp";

const DEFAULT_BUDGET_USD = 5;

/**
 * Impostazioni progetto -> agente Claude per la chat (solo admin). Chiave API
 * e token GitHub si scrivono e basta: il server non li restituisce mai, dice
 * solo se sono salvati (hasApiKey / hasGithubToken).
 */
export function AiAgentSection({ project, onChanged }: { project: Project; onChanged?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [budget, setBudget] = useState(String(DEFAULT_BUDGET_USD));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentConfig(project.id)
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setBudget(String(c.budgetUsd || DEFAULT_BUDGET_USD));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.aiAgent.error);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const budgetUsd = Number(budget);
    const saved = await run(() =>
      saveAgentConfig(project.id, {
        apiKey: apiKey.trim() || undefined,
        githubToken: githubToken.trim() || undefined,
        budgetUsd: Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : DEFAULT_BUDGET_USD,
        mcpUrl: `${mcpBaseUrl()}/mcp`,
      }),
    );
    if (saved) {
      setConfig(saved);
      setApiKey("");
      setGithubToken("");
      setBudget(String(saved.budgetUsd || DEFAULT_BUDGET_USD));
      toast.success(t.aiAgent.saved);
      onChanged?.();
    }
  }

  async function handleRemove() {
    if (!window.confirm(t.aiAgent.removeConfirm)) return;
    const cleared = await run(() => removeAgentConfig(project.id));
    if (cleared) {
      setConfig(cleared);
      setApiKey("");
      setGithubToken("");
      setBudget(String(cleared.budgetUsd || DEFAULT_BUDGET_USD));
      toast.success(t.aiAgent.removed);
      onChanged?.();
    }
  }

  const hasSomething = Boolean(config && (config.configured || config.hasApiKey || config.hasGithubToken));

  return (
    <section className="drawer-section ai-agent-section">
      <h3>
        {t.aiAgent.title}{" "}
        <span className={`token-status ${config?.configured ? "token-active" : "token-revoked"}`}>
          {config?.configured ? t.aiAgent.configured : t.aiAgent.notConfigured}
        </span>
      </h3>
      <p className="ai-hint">{t.aiAgent.intro}</p>

      <form className="ai-routine-form" onSubmit={handleSave}>
        <label>
          {t.aiAgent.apiKey}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasApiKey ? t.aiAgent.savedKeep : t.aiAgent.apiKeyPlaceholder}
            autoComplete="off"
            maxLength={500}
          />
        </label>
        <label>
          {t.aiAgent.githubToken}
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder={config?.hasGithubToken ? t.aiAgent.savedKeep : t.aiAgent.githubTokenPlaceholder}
            autoComplete="off"
            maxLength={500}
          />
        </label>
        <label>
          {t.aiAgent.budget}
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <div className="drawer-list-actions">
          <button type="submit" disabled={busy}>
            {busy ? t.aiAgent.saving : t.aiAgent.save}
          </button>
          {hasSomething && (
            <button type="button" className="danger-button" onClick={handleRemove} disabled={busy}>
              {t.aiAgent.remove}
            </button>
          )}
        </div>
      </form>

      <p className="ai-hint">{t.aiAgent.billingNote}</p>
      {config?.lastError && (
        <p className="ai-failure">
          {t.aiAgent.lastError}: {config.lastError}
        </p>
      )}
      {error && <p className="login-error">{error}</p>}
    </section>
  );
}
