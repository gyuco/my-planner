import { describe, it, expect, vi, afterEach } from "vitest";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  sendWebPush,
  vapidAuthorization,
} from "./webpush.js";

/**
 * Lato "browser" scritto con node:crypto (API diverse da Web Crypto usato
 * dall'implementazione): genera la subscription e decifra il messaggio come
 * prescrive la RFC 8291, cosi' il test non riusa il codice sotto verifica.
 */
function browserSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    keys: { p256dh: base64UrlEncode(ecdh.getPublicKey()), auth: base64UrlEncode(auth) },
  };
}

function browserDecrypt(body: Uint8Array, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const ciphertext = buf.subarray(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);

  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  // Ultimo record: il delimitatore 0x02 chiude il contenuto (nessun padding).
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

afterEach(() => vi.unstubAllGlobals());

describe("webpush — cifratura RFC 8291 (aes128gcm)", () => {
  it("il browser decifra il messaggio", async () => {
    const { ecdh, auth, keys } = browserSubscription();
    const message = JSON.stringify({ title: "Task in TODO", body: "Triage completato ✓", url: "/projects/p?task=t" });
    const body = await encryptPayload(keys, new TextEncoder().encode(message));
    expect(browserDecrypt(body, ecdh, auth)).toBe(message);
  });

  it("ogni invio usa salt e chiave effimera nuovi", async () => {
    const { keys } = browserSubscription();
    const payload = new TextEncoder().encode("x");
    const a = await encryptPayload(keys, payload);
    const b = await encryptPayload(keys, payload);
    expect(base64UrlEncode(a.subarray(0, 86))).not.toBe(base64UrlEncode(b.subarray(0, 86)));
  });

  it("rifiuta chiavi non valide e payload troppo grandi", async () => {
    const { keys } = browserSubscription();
    await expect(encryptPayload({ ...keys, p256dh: base64UrlEncode(new Uint8Array(10)) }, new Uint8Array(1))).rejects.toThrow();
    await expect(encryptPayload(keys, new Uint8Array(4000))).rejects.toThrow("troppo grande");
  });
});

describe("webpush — VAPID (RFC 8292)", () => {
  it("JWT ES256 verificabile con la chiave pubblica, audience = origine dell'endpoint", async () => {
    const { publicKey, privateKeyJwk } = await generateVapidKeys();
    expect(base64UrlDecode(publicKey)).toHaveLength(65);
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { publicKey, privateKeyJwk, subject: "mailto:admin@example.com" },
      1_800_000_000,
    );
    const match = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    expect(match).not.toBeNull();
    const [, h, c, sig, k] = match!;
    expect(k).toBe(publicKey);
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(c)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_800_000_000 + 12 * 3600,
      sub: "mailto:admin@example.com",
    });
    const verifyKey = await crypto.subtle.importKey("raw", base64UrlDecode(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifyKey,
      base64UrlDecode(sig),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });

  it("sendWebPush: header corretti, 410 = subscription da cancellare", async () => {
    const { ecdh, auth, keys } = browserSubscription();
    const vapid = { ...(await generateVapidKeys()), subject: "mailto:a@b.c" };
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: calls.length === 1 ? 201 : 410 });
    });
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", ...keys };

    const ok = await sendWebPush(sub, { title: "Ciao" }, vapid, { topic: "task:abc-1" });
    expect(ok).toEqual({ status: 201, ok: true, gone: false });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Urgency).toBe("high");
    expect(headers.Topic).toBe("taskabc-1");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse(browserDecrypt(calls[0].init.body as Uint8Array, ecdh, auth))).toEqual({ title: "Ciao" });

    expect(await sendWebPush(sub, { title: "x" }, vapid)).toEqual({ status: 410, ok: false, gone: true });
  });
});

describe("webpush — endpoint ammessi (anti SSRF)", () => {
  it("solo push service noti in https", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example.com/fcm.googleapis.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});
