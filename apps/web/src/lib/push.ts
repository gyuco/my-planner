import { getPushPublicKey, registerPushDevice } from "../api";

/**
 * Notifiche push del browser (Web Push). Il service worker (/sw.js) mostra le
 * notifiche; qui c'e' l'iscrizione del dispositivo e la sua registrazione sul
 * server. Su iPhone/iPad funziona solo con l'app aggiunta alla schermata Home.
 */

export type PushSupport = "supported" | "unsupported" | "ios-needs-install";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function pushSupport(): PushSupport {
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-needs-install";
  return apis ? "supported" : "unsupported";
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Nome leggibile del dispositivo, es. "Chrome · Android". */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : isIos()
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** Subscription attuale del browser, se c'e'. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveOnServer(sub: PushSubscription, locale: string) {
  const json = sub.toJSON();
  return registerPushDevice({
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    locale,
    label: deviceLabel(),
  });
}

/**
 * Chiede il permesso, iscrive il browser al push service con la chiave VAPID
 * del server e registra il dispositivo. Lancia "denied" se l'utente rifiuta.
 */
export async function enablePush(locale: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const reg = await registration();
  const { publicKey } = await getPushPublicKey();
  let sub = await reg.pushManager.getSubscription();
  // Una subscription creata con un'altra chiave VAPID non funzionerebbe: si rifa'.
  const key = sub?.options.applicationServerKey;
  if (sub && key && btoa(String.fromCharCode(...new Uint8Array(key))) !== btoa(String.fromCharCode(...base64UrlToBytes(publicKey)))) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  }
  return saveOnServer(sub, locale);
}

/** Disiscrive il browser (il dispositivo va rimosso anche dal server). */
export async function disablePushOnThisDevice(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/**
 * All'avvio dell'app: se il permesso c'e' gia' e il browser e' iscritto,
 * ri-registra la subscription (rinnovi del browser, cambio lingua o utente).
 */
export async function syncPushSubscription(locale: string) {
  try {
    if (pushSupport() !== "supported" || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub) await saveOnServer(sub, locale);
  } catch {
    // best effort
  }
}
