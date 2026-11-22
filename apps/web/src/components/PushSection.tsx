import { useEffect, useState } from "react";
import type { PushDevice } from "@my-planner/core";
import { ApiRequestError, listPushDevices, removePushDevice, sendTestPush } from "../api";
import { useI18n } from "../i18n";
import { useToast } from "../lib/toast";
import { currentSubscription, disablePushOnThisDevice, enablePush, pushSupport } from "../lib/push";

// Id del dispositivo registrato da questo browser, per riconoscerlo nell'elenco.
const DEVICE_ID_KEY = "my-planner:push-device-id";

function readDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

function writeDeviceId(id: string | null) {
  try {
    if (id) localStorage.setItem(DEVICE_ID_KEY, id);
    else localStorage.removeItem(DEVICE_ID_KEY);
  } catch {
    /* solo comodita' */
  }
}

/** Profilo -> notifiche push: attivazione su questo dispositivo, prova, elenco dispositivi. */
export function PushSection() {
  const { t, locale, formatDate, formatDateTime } = useI18n();
  const toast = useToast();
  const support = pushSupport();
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(readDeviceId);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPushDevices().then(setDevices).catch(() => undefined);
    currentSubscription()
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => undefined);
  }, []);

  const active = subscribed && Boolean(thisDeviceId) && devices.some((d) => d.id === thisDeviceId);
  const denied = support === "supported" && typeof Notification !== "undefined" && Notification.permission === "denied";

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const device = await enablePush(locale);
      writeDeviceId(device.id);
      setThisDeviceId(device.id);
      setSubscribed(true);
      setDevices(await listPushDevices());
    } catch (err) {
      if (err instanceof Error && err.message === "denied") setError(t.push.denied);
      else setError(err instanceof ApiRequestError ? err.message : t.push.error);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      await disablePushOnThisDevice();
      if (thisDeviceId) await removePushDevice(thisDeviceId).catch(() => undefined);
      writeDeviceId(null);
      setThisDeviceId(null);
      setSubscribed(false);
      setDevices(await listPushDevices());
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    try {
      const { sent } = await sendTestPush();
      if (sent > 0) toast.success(t.push.testSent);
      else toast.error(t.push.testNone);
      setDevices(await listPushDevices());
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t.push.error);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    if (id === thisDeviceId) return handleDisable();
    await removePushDevice(id).catch(() => undefined);
    setDevices((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div className="profile-section push-section">
      <span className="field-label">{t.push.title}</span>
      <p className="profile-hint">{t.push.hint}</p>

      {support === "ios-needs-install" && <p className="push-notice">{t.push.iosInstall}</p>}
      {support === "unsupported" && <p className="push-notice">{t.push.unsupported}</p>}
      {denied && <p className="push-notice">{t.push.denied}</p>}

      {support === "supported" && !denied && (
        <div className="profile-actions push-actions">
          {active ? (
            <>
              <span className="push-status">✓ {t.push.enabled}</span>
              <button type="button" onClick={handleTest} disabled={busy}>
                {t.push.test}
              </button>
              <button type="button" onClick={handleDisable} disabled={busy}>
                {t.push.disable}
              </button>
            </>
          ) : (
            <button type="button" onClick={handleEnable} disabled={busy} aria-busy={busy}>
              {busy ? t.push.enabling : t.push.enable}
            </button>
          )}
        </div>
      )}
      {error && <p className="login-error" role="alert">{error}</p>}

      <span className="field-label profile-subsection">{t.push.devices}</span>
      {devices.length === 0 ? (
        <p className="profile-hint">{t.push.noDevices}</p>
      ) : (
        <ul className="drawer-list">
          {devices.map((d) => (
            <li key={d.id}>
              <span>
                {d.label || d.service}
                {d.id === thisDeviceId && <strong> · {t.push.thisDevice}</strong>} — {t.push.addedOn} {formatDate(d.createdAt)} ·{" "}
                {d.lastSuccessAt ? `${t.push.lastUsed} ${formatDateTime(d.lastSuccessAt)}` : t.push.never}
              </span>
              <div className="drawer-list-actions">
                <button type="button" onClick={() => handleRemove(d.id)} disabled={busy}>
                  {t.push.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
