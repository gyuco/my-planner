import { useEffect, useState } from "react";
import type { AuthUser } from "@my-planner/core";
import { getMyAvatar } from "../api";
import { userInitials } from "./user";

/** Lato (px) dell'avatar salvato: basta per la retina della pagina profilo. */
const AVATAR_SIZE = 256;

/**
 * Ritaglia al centro un'immagine scelta dall'utente, la scala a 256x256 e la
 * restituisce come data URL (WebP, con fallback JPEG dove WebP non e'
 * supportato). Cosi' il server riceve sempre un file piccolo e uniforme.
 */
export async function imageFileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d non disponibile");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const webp = canvas.toDataURL("image/webp", 0.86);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}

// Cache di sessione: chiave "<userId>:<avatarVersion>" -> data URL.
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function cacheKey(user: AuthUser): string | null {
  return user.avatarVersion ? `${user.id}:${user.avatarVersion}` : null;
}

/** Aggiorna la cache dopo un upload, evitando un GET appena salvato. */
export function primeAvatarCache(user: AuthUser, dataUrl: string | null) {
  const key = cacheKey(user);
  if (key) cache.set(key, dataUrl);
}

/** Data URL dell'avatar dell'utente corrente (null se assente o in caricamento). */
export function useOwnAvatar(user: AuthUser): string | null {
  const key = cacheKey(user);
  const [url, setUrl] = useState<string | null>(key ? cache.get(key) ?? null : null);

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    if (cache.has(key)) {
      setUrl(cache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    let request = pending.get(key);
    if (!request) {
      request = getMyAvatar()
        .then((res) => res.dataUrl)
        .catch(() => null)
        .then((dataUrl) => {
          cache.set(key, dataUrl);
          pending.delete(key);
          return dataUrl;
        });
      pending.set(key, request);
    }
    request.then((dataUrl) => {
      if (!cancelled) setUrl(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return url;
}

/** Contenuto di un avatar: foto se caricata, altrimenti iniziali. */
export function OwnAvatarContent({ user }: { user: AuthUser }) {
  const url = useOwnAvatar(user);
  if (url) return <img className="avatar-img" src={url} alt="" />;
  return <>{userInitials(user)}</>;
}
