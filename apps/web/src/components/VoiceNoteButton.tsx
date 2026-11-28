import { useEffect, useRef, useState } from "react";
import type { Comment } from "@my-planner/core";
import { ApiRequestError, uploadVoiceNote } from "../api";
import { useI18n } from "../i18n";
import { useAiFeatures } from "../lib/aiFeatures";
import { useToast } from "../lib/toast";
import { MicIcon } from "./Icons";

/** Oltre questa durata la registrazione si ferma e parte la trascrizione. */
const MAX_RECORDING_MS = 5 * 60 * 1000;

/** Primo formato supportato dal browser (Safari/iOS registra solo mp4). */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type Phase = "idle" | "recording" | "uploading";

interface VoiceNoteButtonProps {
  taskId: string;
  onSaved: (comment: Comment) => void;
}

/**
 * Nota vocale (pensata per lo smartphone): registra dal microfono, invia
 * l'audio al server che lo trascrive con Whisper (Workers AI) e lo salva come
 * commento. Nascosto se il server non ha Workers AI o il browser non registra.
 */
export function VoiceNoteButton({ taskId, onSaved }: VoiceNoteButtonProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { voiceNotes } = useAiFeatures();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  function cleanup() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }

  // Chiudendo il drawer a registrazione in corso: microfono rilasciato, niente invio.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      cleanup();
    };
  }, []);

  if (!voiceNotes || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;

  async function upload(blob: Blob) {
    setPhase("uploading");
    try {
      const { comment } = await uploadVoiceNote(taskId, blob, locale);
      onSaved(comment);
      toast.success(t.semantic.voiceSaved);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t.semantic.voiceError);
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t.semantic.voiceMicDenied);
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "audio/webm";
      cleanup();
      if (cancelledRef.current) {
        setPhase("idle");
        return;
      }
      void upload(new Blob(chunksRef.current, { type }));
    };
    recorder.start();
    const startedAt = Date.now();
    setElapsed(0);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) stop();
    }, 250);
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function cancel() {
    cancelledRef.current = true;
    stop();
  }

  if (phase === "recording") {
    return (
      <div className="voice-note is-recording" role="status">
        <span className="voice-note-dot" aria-hidden="true" />
        <span className="voice-note-time">{formatElapsed(elapsed)}</span>
        <button type="button" className="voice-note-stop" onClick={stop}>
          {t.semantic.voiceStop}
        </button>
        <button type="button" className="voice-note-cancel" onClick={cancel}>
          {t.semantic.voiceCancel}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="voice-note-button"
      onClick={start}
      disabled={phase === "uploading"}
      title={t.semantic.voiceRecordHint}
    >
      <MicIcon /> {phase === "uploading" ? t.semantic.voiceTranscribing : t.semantic.voiceRecord}
    </button>
  );
}
