import { useEffect, useState } from "react";
import type { SessionHookToken } from "@my-planner/core";
import { ApiRequestError, createMyHookToken, listMyHookTokens, revokeMyHookToken } from "../api";
import { useI18n } from "../i18n";
import { copyText } from "../lib/clipboard";

/**
 * Token degli hook di Claude Code (vista "In corso"): creazione (il token in
 * chiaro si vede una volta sola), elenco, revoca e istruzioni di setup.
 * L'URL per gli hook e' la REST API dietro /api, uguale in tutti i deploy.
 */
export function HookTokensSection() {
  const { t, formatDate, formatDateTime } = useI18n();
  const [tokens, setTokens] = useState<SessionHookToken[]>([]);
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const apiUrl = `${window.location.origin}/api`;
  const envLines = `export MY_PLANNER_URL=${apiUrl}\nexport MY_PLANNER_HOOK_TOKEN=${revealed ?? "mph_..."}`;

  useEffect(() => {
    listMyHookTokens()
      .then(setTokens)
      .catch(() => setError(t.globalMcp.loadError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    setError(null);
    try {
      const created = await createMyHookToken(label.trim() || null);
      const { token, ...rest } = created;
      setTokens((prev) => [rest, ...prev]);
      setRevealed(token);
      setLabel("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.hookTokens.createError);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm(t.globalMcp.revokeConfirm)) return;
    setError(null);
    try {
      const revoked = await revokeMyHookToken(id);
      setTokens((prev) => prev.map((tok) => (tok.id === id ? revoked : tok)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.globalMcp.revokeError);
    }
  }

  async function handleCopy() {
    if (await copyText(envLines)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="profile-section" id="hook-tokens">
      <span className="field-label">{t.hookTokens.title}</span>
      <p className="profile-hint">{t.hookTokens.hint}</p>

      <div className="token-reveal-row hook-token-create">
        <input
          type="text"
          aria-label={t.hookTokens.labelPlaceholder}
          value={label}
          maxLength={100}
          placeholder={t.hookTokens.labelPlaceholder}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" onClick={handleCreate}>
          {t.hookTokens.create}
        </button>
      </div>
      {revealed && <p className="profile-hint" role="status">{t.hookTokens.created}</p>}

      <span className="field-label profile-subsection">{t.hookTokens.setupTitle}</span>
      <p className="profile-hint">{t.hookTokens.setupEnv}</p>
      <pre className="hook-env">
        <code>{envLines}</code>
      </pre>
      <div>
        <button type="button" onClick={handleCopy}>
          {copied ? t.common.copied : t.common.copy}
        </button>
      </div>
      <p className="profile-hint">{t.hookTokens.setupScript}</p>
      <p className="profile-hint">{t.hookTokens.setupCloud}</p>

      <span className="field-label profile-subsection">{t.hookTokens.tokens}</span>
      {error && <p className="login-error">{error}</p>}
      {tokens.length === 0 ? (
        <p className="profile-hint">{t.hookTokens.none}</p>
      ) : (
        <ul className="drawer-list">
          {tokens.map((tok) => (
            <li key={tok.id}>
              <span>
                {tok.label || "—"} — {formatDate(tok.createdAt)} ·{" "}
                {tok.lastUsedAt ? `${t.globalMcp.lastUsed} ${formatDateTime(tok.lastUsedAt)}` : t.globalMcp.neverUsed}{" "}
                {tok.revokedAt ? (
                  <span className="token-status token-revoked">{t.globalMcp.revoked}</span>
                ) : (
                  <span className="token-status token-active">{t.globalMcp.active}</span>
                )}
              </span>
              {!tok.revokedAt && (
                <div className="drawer-list-actions">
                  <button type="button" onClick={() => handleRevoke(tok.id)}>
                    {t.globalMcp.revoke}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
