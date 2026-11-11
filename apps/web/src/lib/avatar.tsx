import { useEffect, useState } from "react";
import type { AuthUser } from "@my-planner/core";
import { getUserAvatar } from "../api";
import { userInitials } from "./user";

/** Lato (px) dell'avatar salvato: basta per la retina della pagina profilo. */
export const AVATAR_SIZE = 256;

/**
 * Disegna la porzione quadrata (sx, sy, size) dell'immagine su un canvas
 * 256x256 e la restituisce come data URL WebP (JPEG dove WebP non e'
 * supportato). Il ritaglio lo sceglie l'utente in AvatarCropModal.
 */
export function cropToAvatarDataUrl(
  image: CanvasImageSource,
  sx: number,
  sy: number,
  size: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d non disponibile");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.86);
}

// Cache di sessione condivisa da topbar, profilo e card: chiave
// "<userId>:<avatarVersion>" -> data URL. `pending` deduplica le richieste
// quando molte card mostrano lo stesso assegnatario.
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function keyOf(userId: string | null | undefined, version: number | null | undefined): string | null {
  return userId && version ? `${userId}:${version}` : null;
}

/** Aggiorna la cache dopo un upload, evitando un GET appena salvato. */
export function primeAvatarCache(userId: string, version: number | null, dataUrl: string | null) {
  const key = keyOf(userId, version);
  if (key) cache.set(key, dataUrl);
}

/** Data URL dell'avatar di un utente (null se assente, non visibile o in caricamento). */
export function useUserAvatar(userId: string | null | undefined, version: number | null | undefined): string | null {
  const key = keyOf(userId, version);
  const [url, setUrl] = useState<string | null>(key ? cache.get(key) ?? null : null);

  useEffect(() => {
    if (!key || !userId) {
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
      request = getUserAvatar(userId)
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
  }, [key, userId]);

  return url;
}

/** Contenuto dell'avatar dell'utente corrente: foto se caricata, altrimenti iniziali. */
export function OwnAvatarContent({ user }: { user: AuthUser }) {
  const url = useUserAvatar(user.id, user.avatarVersion);
  if (url) return <img className="avatar-img" src={url} alt="" />;
  return <>{userInitials(user)}</>;
}

/** Avatar dell'assegnatario sulle card: foto se disponibile, altrimenti `fallback` (iniziali). */
export function UserAvatarContent({
  userId,
  version,
  fallback,
}: {
  userId: string | null;
  version: number | null | undefined;
  fallback: string;
}) {
  const url = useUserAvatar(userId, version);
  if (url) return <img className="avatar-img" src={url} alt="" />;
  return <>{fallback}</>;
}
