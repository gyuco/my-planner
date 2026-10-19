/**
 * Cifratura dei segreti salvati in DB (es. password SMTP in EmailSettings).
 *
 * AES-256-GCM via Web Crypto (`crypto.subtle`), disponibile sia su Node 20+
 * sia su Workers, quindi lo stesso codice gira in entrambi i runtime. La
 * chiave e' derivata con HKDF dal segreto di deployment:
 *  - SETTINGS_ENCRYPTION_KEY, se impostato (consigliato: ruotare JWT_SECRET
 *    non invalida i segreti salvati);
 *  - altrimenti JWT_SECRET, sempre presente (il server non parte senza).
 * Il DB da solo (backup, dump, accesso in lettura) non basta a leggere i
 * segreti. Se la chiave cambia, la decifratura fallisce e il segreto va
 * reinserito dalla UI.
 *
 * Formato salvato: `v1:<iv base64>:<ciphertext+tag base64>`.
 */

const VERSION = "v1";
const HKDF_SALT = new TextEncoder().encode("my-planner/secret-box");
const HKDF_INFO = new TextEncoder().encode("settings-secrets/v1");

type SecretKeyProvider = () => string | null | undefined;

// Node: process.env. Il Worker registra il proprio provider (env per
// richiesta) da src/cf/index.ts, perche' li' process.env non e' garantito.
let provider: SecretKeyProvider = () => {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return env?.SETTINGS_ENCRYPTION_KEY?.trim() || env?.JWT_SECRET?.trim() || null;
};

export function setSecretKeyProvider(p: SecretKeyProvider) {
  provider = p;
}

async function deriveKey(): Promise<CryptoKey> {
  const secret = provider();
  if (!secret) throw new Error("Chiave di cifratura non disponibile (SETTINGS_ENCRYPTION_KEY / JWT_SECRET)");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

/** Lancia se il formato non e' valido o la chiave non corrisponde (tag GCM). */
export async function decryptSecret(stored: string): Promise<string> {
  const [version, iv, ciphertext] = stored.split(":");
  if (version !== VERSION || !iv || !ciphertext) throw new Error("Formato segreto cifrato non riconosciuto");
  const key = await deriveKey();
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(ciphertext));
  return new TextDecoder().decode(plaintext);
}
