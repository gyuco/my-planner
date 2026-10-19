import { useEffect, useState } from "react";
import type { EmailSecurity } from "@my-planner/core";
import { ApiRequestError, getEmailSettings, sendTestEmail, updateEmailSettings } from "../api";
import { useI18n } from "../i18n";

interface EmailSettingsModalProps {
  onClose: () => void;
}

// Porta suggerita al cambio di sicurezza, solo se l'utente non ne ha scelta
// una diversa da quelle standard.
const DEFAULT_PORTS: Record<EmailSecurity, number> = { tls: 465, starttls: 587, none: 25 };

export function EmailSettingsModal({ onClose }: EmailSettingsModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("465");
  const [security, setSecurity] = useState<EmailSecurity>("tls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAlreadySet, setPasswordAlreadySet] = useState(false);
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("my-planner");
  const [appUrl, setAppUrl] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getEmailSettings();
        setEnabled(settings.enabled);
        setConfigured(settings.configured);
        setHost(settings.host ?? "");
        setPort(String(settings.port));
        setSecurity(settings.security);
        setUsername(settings.username ?? "");
        setPasswordAlreadySet(settings.passwordSet);
        setFromAddress(settings.fromAddress ?? "");
        setFromName(settings.fromName);
        setAppUrl(settings.appUrl ?? window.location.origin);
      } catch (err) {
        setLoadError(err instanceof ApiRequestError ? err.message : t.emailSettings.loadError);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSecurityChange(next: EmailSecurity) {
    if (Object.values(DEFAULT_PORTS).includes(Number(port))) setPort(String(DEFAULT_PORTS[next]));
    // Credenziali mai in chiaro: il server le rifiuta senza TLS.
    if (next === "none") {
      setUsername("");
      setPassword("");
    }
    setSecurity(next);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateEmailSettings({
        enabled,
        host: host.trim() || null,
        port: Number(port),
        security,
        username: username.trim() || null,
        password: password || undefined,
        fromAddress: fromAddress.trim() || null,
        fromName: fromName.trim() || undefined,
        appUrl: appUrl.trim() || null,
      });
      setConfigured(updated.configured);
      setPasswordAlreadySet(updated.passwordSet);
      setPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : t.emailSettings.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    setTesting(true);
    try {
      const res = await sendTestEmail(testTo.trim() || undefined);
      setTestResult({ ok: true, message: t.emailSettings.testSent.replace("{to}", res.to) });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof ApiRequestError ? err.message : t.emailSettings.testError });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.emailSettings.title}</h2>

        {loading ? (
          <p>{t.emailSettings.loading}</p>
        ) : (
          <form onSubmit={handleSave}>
            <section className="drawer-section">
              {loadError && <p className="login-error">{loadError}</p>}
              <label className="storage-backend-option">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                {t.emailSettings.enabledLabel}
              </label>
              <p className="drawer-empty">
                {configured ? t.emailSettings.statusActive : t.emailSettings.statusInactive}
              </p>
              <p className="drawer-empty">{t.emailSettings.hint}</p>
            </section>

            <section className="drawer-section">
              <h3>{t.emailSettings.serverSection}</h3>
              <label>
                {t.emailSettings.hostLabel}
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  required={enabled}
                />
              </label>
              <label>
                {t.emailSettings.securityLabel}
                <select value={security} onChange={(e) => handleSecurityChange(e.target.value as EmailSecurity)}>
                  <option value="tls">{t.emailSettings.securityTls}</option>
                  <option value="starttls">{t.emailSettings.securityStarttls}</option>
                  <option value="none">{t.emailSettings.securityNone}</option>
                </select>
              </label>
              <label>
                {t.emailSettings.portLabel}
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                />
              </label>
              <label>
                {t.emailSettings.usernameLabel}
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                  disabled={security === "none"}
                />
              </label>
              <label>
                {t.emailSettings.passwordLabel}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={security === "none"}
                  placeholder={passwordAlreadySet ? t.emailSettings.secretUnchangedPlaceholder : ""}
                />
              </label>
              <p className="drawer-empty">{t.emailSettings.passwordHint}</p>
            </section>

            <section className="drawer-section">
              <h3>{t.emailSettings.senderSection}</h3>
              <label>
                {t.emailSettings.fromAddressLabel}
                <input
                  type="email"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  required={enabled}
                />
              </label>
              <label>
                {t.emailSettings.fromNameLabel}
                <input value={fromName} onChange={(e) => setFromName(e.target.value)} />
              </label>
              <label>
                {t.emailSettings.appUrlLabel}
                <input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://" />
              </label>
            </section>

            <section className="drawer-section">
              <h3>{t.emailSettings.testSection}</h3>
              <p className="drawer-empty">{t.emailSettings.testHint}</p>
              <label>
                {t.emailSettings.testToLabel}
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </label>
              <button type="button" onClick={handleTest} disabled={testing}>
                {testing ? t.emailSettings.sendingTest : t.emailSettings.sendTest}
              </button>
              {testResult && <p className={testResult.ok ? "drawer-empty" : "login-error"}>{testResult.message}</p>}
            </section>

            {saveError && <p className="login-error">{saveError}</p>}

            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                {t.emailSettings.close}
              </button>
              <button type="submit" disabled={saving}>
                {saving ? t.emailSettings.saving : saved ? t.emailSettings.saved : t.emailSettings.save}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
