/**
 * Web Push senza dipendenze, solo Web Crypto (Node 20+ e Cloudflare Workers):
 *  - cifratura del payload: RFC 8291 (Message Encryption for Web Push), con
 *    content coding `aes128gcm` (RFC 8188), un solo record;
 *  - autenticazione verso il push service: VAPID (RFC 8292), JWT ES256.
 *
 * Il chiamante fornisce la subscription del browser (endpoint + chiavi
 * `p256dh`/`auth`) e la coppia di chiavi VAPID dell'applicazione.
 */

export interface PushSubscriptionKeys {
  endpoint: string;
  /** Chiave pubblica P-256 del browser, non compressa (65 byte), base64url. */
  p256dh: string;
  /** Segreto di autenticazione del browser (16 byte), base64url. */
  auth: string;
}

export interface VapidKeys {
  /** Chiave pubblica P-256 non compressa (65 byte), base64url: l'applicationServerKey del browser. */
  publicKey: string;
  /** Chiave privata in formato JWK (JSON). */
  privateKeyJwk: JsonWebKey;
  /** `mailto:` o URL https di contatto, richiesto dai push service. */
  subject: string;
}

export interface WebPushResult {
  status: number;
  /** true se il push service dice che la subscription non esiste piu' (va cancellata). */
  gone: boolean;
  ok: boolean;
}

const RECORD_SIZE = 4096;
const enc = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Genera una nuova coppia di chiavi VAPID (P-256). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKeyJwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const privateKeyJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: base64UrlEncode(raw), privateKeyJwk };
}

/**
 * Cifra `payload` per la subscription (RFC 8291 + RFC 8188 aes128gcm).
 * `salt` e la coppia effimera sono iniettabili solo per i test.
 */
export async function encryptPayload(
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  payload: Uint8Array<ArrayBuffer>,
  testing?: { salt?: Uint8Array<ArrayBuffer>; ephemeral?: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlDecode(sub.p256dh);
  const authSecret = base64UrlDecode(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("Chiave p256dh non valida");
  if (authSecret.length < 16) throw new Error("Segreto auth non valido");
  // Un solo record: payload + delimitatore (0x02) + tag GCM (16) entro RECORD_SIZE.
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error("Payload push troppo grande");

  const ephemeral =
    testing?.ephemeral ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256),
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = testing?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = ultimo record, nessun padding
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  // Header aes128gcm: salt(16) | rs(uint32 BE) | idlen(1) | keyid(=as_public, 65)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** Header Authorization VAPID (`vapid t=<jwt>, k=<chiave pubblica>`) per l'endpoint. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)) {
  const audience = new URL(endpoint).origin;
  const header = base64UrlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // Scadenza massima consentita: 24h. 12h lasciano margine agli orologi sfasati.
  const claims = base64UrlEncode(enc.encode(JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: vapid.subject })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", vapid.privateKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // Web Crypto restituisce la firma ECDSA gia' nel formato r||s (64 byte) richiesto da JWS.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

/** Invia un messaggio push (JSON) alla subscription. Non lancia sugli errori HTTP. */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  message: unknown,
  vapid: VapidKeys,
  options: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<WebPushResult> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? 24 * 3600),
    Urgency: options.urgency ?? "high",
  };
  // Topic: un nuovo messaggio con lo stesso topic sostituisce quello non ancora consegnato.
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410 };
}

/**
 * Host dei push service dei browser. Il server fa POST verso l'endpoint
 * fornito dal client: senza questo elenco un utente potrebbe far chiamare al
 * server un URL qualsiasi (SSRF).
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge (Android/desktop), Opera
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari (macOS, iOS/iPadOS da app installata)
  "notify.windows.com", // Edge legacy / Windows
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
