import { useEffect, useState } from "react";
import type { UserMcpToken } from "@my-planner/core";
import { ApiRequestError, listMyMcpTokens, revokeMyMcpToken } from "../api";
import { useI18n } from "../i18n";
import { copyText } from "../lib/clipboard";
import { mcpBaseUrl } from "../lib/mcp";
import { Link } from "react-router-dom";

/**
 * MCP globale (/mcp/global) nella pagina profilo: URL del connector da
 * aggiungere in Claude e elenco/revoca delle connessioni autorizzate.
 * Il token non si genera da qui: lo emette il login web OAuth (/authorize)
 * quando il client si collega, cosi' il permesso passa sempre dal browser.
 */
export function GlobalMcpSection() {
  const { t, formatDate, formatDateTime } = useI18n();
  const [tokens, setTokens] = useState<UserMcpToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "cli" | null>(null);

  const url = `${mcpBaseUrl()}/mcp/global`;
  const cliCommand = `claude mcp add --transport http my-planner ${url}`;

  useEffect(() => {
    listMyMcpTokens()
      .then(setTokens)
      .catch(() => setError(t.globalMcp.loadError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopy(kind: "url" | "cli") {
    if (await copyText(kind === "url" ? url : cliCommand)) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm(t.globalMcp.revokeConfirm)) return;
    setError(null);
    try {
      const revoked = await revokeMyMcpToken(id);
      setTokens((prev) => prev.map((tok) => (tok.id === id ? revoked : tok)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.globalMcp.revokeError);
    }
  }

  return (
    <div className="profile-section global-mcp-section">
      <span className="field-label">{t.globalMcp.title}</span>
      <p className="profile-hint">
        {t.globalMcp.hint}{" "}
        <Link className="guide-link" to="/guide#guide-connector">
          {t.guide.readGuide}
        </Link>
      </p>

      <span className="field-label profile-subsection">{t.globalMcp.urlLabel}</span>
      <div className="token-reveal-row">
        <code>{url}</code>
        <button type="button" onClick={() => handleCopy("url")}>
          {copied === "url" ? t.common.copied : t.common.copy}
        </button>
      </div>

      <span className="field-label profile-subsection">{t.globalMcp.claudeCodeLabel}</span>
      <div className="token-reveal-row">
        <code>{cliCommand}</code>
        <button type="button" onClick={() => handleCopy("cli")}>
          {copied === "cli" ? t.common.copied : t.common.copy}
        </button>
      </div>

      <span className="field-label profile-subsection">{t.globalMcp.connections}</span>
      {error && <p className="login-error">{error}</p>}
      {tokens.length === 0 ? (
        <p className="profile-hint">{t.globalMcp.noConnections}</p>
      ) : (
        <ul className="drawer-list">
          {tokens.map((tok) => (
            <li key={tok.id}>
              <span>
                {tok.label || t.globalMcp.unnamed} — {t.globalMcp.authorizedOn} {formatDate(tok.createdAt)} ·{" "}
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
