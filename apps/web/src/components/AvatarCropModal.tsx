import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { cropToAvatarDataUrl } from "../lib/avatar";

/** Lato del riquadro di ritaglio a schermo (px CSS). */
const VIEWPORT = 280;
const MAX_ZOOM = 4;

interface AvatarCropModalProps {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  /** Riceve il data URL 256x256 della porzione scelta. */
  onConfirm: (dataUrl: string) => void;
}

interface Natural {
  w: number;
  h: number;
}

/**
 * Ritaglio dell'avatar: l'immagine riempie un riquadro quadrato con maschera
 * circolare; l'utente la trascina (mouse/touch) e la ingrandisce con lo
 * slider o la rotella. Al salvataggio la porzione visibile viene ridotta a
 * 256x256 sul canvas.
 */
export function AvatarCropModal({ file, busy, onCancel, onConfirm }: AvatarCropModalProps) {
  const { t } = useI18n();
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Scala "cover": al minimo zoom il lato corto dell'immagine riempie il riquadro.
  const baseScale = natural ? VIEWPORT / Math.min(natural.w, natural.h) : 1;
  const scale = baseScale * zoom;

  function clamp(x: number, y: number, s = scale) {
    if (!natural) return { x, y };
    const minX = VIEWPORT - natural.w * s;
    const minY = VIEWPORT - natural.h * s;
    return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
  }

  function handleLoad() {
    const img = imgRef.current;
    if (!img) return;
    const n = { w: img.naturalWidth, h: img.naturalHeight };
    const s = VIEWPORT / Math.min(n.w, n.h);
    setNatural(n);
    setZoom(1);
    setOffset({ x: (VIEWPORT - n.w * s) / 2, y: (VIEWPORT - n.h * s) / 2 });
  }

  // Lo zoom mantiene fisso il centro del riquadro.
  function applyZoom(next: number) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const newScale = baseScale * z;
    const c = VIEWPORT / 2;
    const ratio = newScale / scale;
    setOffset(clamp(c - (c - offset.x) * ratio, c - (c - offset.y) * ratio, newScale));
    setZoom(z);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { id: d.id, x: e.clientX, y: e.clientY };
    setOffset((o) => clamp(o.x + dx, o.y + dy));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img || !natural) return;
    const size = VIEWPORT / scale;
    onConfirm(cropToAvatarDataUrl(img, -offset.x / scale, -offset.y / scale, size));
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        className="modal avatar-crop-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="avatar-crop-title">{t.profile.avatarCropTitle}</h2>
        <p className="profile-hint">{t.profile.avatarCropHint}</p>

        <div
          className="avatar-crop-viewport"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => applyZoom(zoom - e.deltaY * 0.002)}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={handleLoad}
              style={
                natural
                  ? {
                      width: natural.w * scale,
                      height: natural.h * scale,
                      transform: `translate(${offset.x}px, ${offset.y}px)`,
                    }
                  : { visibility: "hidden" }
              }
            />
          )}
        </div>

        <label className="avatar-crop-zoom">
          <span>{t.profile.avatarZoom}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            aria-label={t.profile.avatarZoom}
          />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            {t.profile.avatarCropCancel}
          </button>
          <button type="button" className="avatar-crop-confirm" onClick={handleConfirm} disabled={busy || !natural}>
            {busy ? t.profile.avatarUploading : t.profile.avatarCropApply}
          </button>
        </div>
      </div>
    </div>
  );
}
