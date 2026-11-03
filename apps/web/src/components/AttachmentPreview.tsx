import { useEffect, useState } from "react";
import type { Attachment } from "@my-planner/core";
import { fetchAttachmentBlob } from "../api";
import { previewKind, previewMimeType } from "../lib/attachmentPreview";
import { useI18n } from "../i18n";

/**
 * Object URL di un allegato, caricato con JWT e revocato allo smontaggio.
 * `enabled=false` rimanda il fetch (es. video: si scarica solo all'apertura).
 */
function useAttachmentObjectUrl(attachment: Attachment | undefined, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Dipendenze primitive: dopo un refresh del drawer gli oggetti Attachment
  // cambiano identita' ma non contenuto, e non serve riscaricare il file.
  const id = attachment?.id;
  const mime = attachment ? previewMimeType(attachment) : undefined;

  useEffect(() => {
    if (!enabled || !id) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    fetchAttachmentBlob(id, mime)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [id, mime, enabled]);

  return { url, failed };
}

interface AttachmentThumbProps {
  attachment: Attachment;
  onOpen: () => void;
}

/** Miniatura cliccabile: immagine reale per le foto, tile "play" per i video. */
export function AttachmentThumb({ attachment, onOpen }: AttachmentThumbProps) {
  const { t } = useI18n();
  const kind = previewKind(attachment);
  const { url, failed } = useAttachmentObjectUrl(attachment, kind === "image");
  if (!kind) return null;

  return (
    <button
      type="button"
      className={`attachment-thumb attachment-thumb-${kind}`}
      onClick={onOpen}
      title={kind === "video" ? t.taskDrawer.playVideo : t.taskDrawer.previewImage}
      aria-label={`${kind === "video" ? t.taskDrawer.playVideo : t.taskDrawer.previewImage}: ${attachment.fileName}`}
    >
      {kind === "image" ? (
        url ? (
          <img src={url} alt="" loading="lazy" />
        ) : (
          <span className="attachment-thumb-placeholder" aria-hidden="true">
            {failed ? "!" : "…"}
          </span>
        )
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

interface MediaLightboxProps {
  items: Attachment[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload: (attachment: Attachment) => void;
}

/** Visualizzatore a schermo intero per immagini e video, con navigazione tra gli allegati media. */
export function MediaLightbox({ items, index, onIndexChange, onClose, onDownload }: MediaLightboxProps) {
  const { t } = useI18n();
  const attachment = items[index];
  const kind = attachment ? previewKind(attachment) : null;
  const { url, failed } = useAttachmentObjectUrl(attachment, true);
  const hasMany = items.length > 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (hasMany && e.key === "ArrowRight") {
        onIndexChange((index + 1) % items.length);
      } else if (hasMany && e.key === "ArrowLeft") {
        onIndexChange((index - 1 + items.length) % items.length);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hasMany, index, items.length, onClose, onIndexChange]);

  if (!attachment || !kind) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={attachment.fileName}>
      <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-title">
          {attachment.fileName}
          {hasMany && <span className="lightbox-counter"> · {index + 1}/{items.length}</span>}
        </span>
        <button type="button" onClick={() => onDownload(attachment)}>
          {t.taskDrawer.download}
        </button>
        <button type="button" className="lightbox-close" onClick={onClose} aria-label={t.taskDrawer.closeTitle}>
          &times;
        </button>
      </div>

      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {failed ? (
          <p className="lightbox-message">{t.taskDrawer.previewError}</p>
        ) : !url ? (
          <p className="lightbox-message">{t.taskDrawer.loading}</p>
        ) : kind === "image" ? (
          <img key={url} src={url} alt={attachment.fileName} />
        ) : (
          <video key={url} src={url} controls autoPlay playsInline>
            {t.taskDrawer.videoUnsupported}
          </video>
        )}
      </div>

      {hasMany && (
        <>
          <button
            type="button"
            className="lightbox-nav lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index - 1 + items.length) % items.length);
            }}
            aria-label={t.taskDrawer.previous}
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-nav lightbox-next"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + 1) % items.length);
            }}
            aria-label={t.taskDrawer.next}
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
