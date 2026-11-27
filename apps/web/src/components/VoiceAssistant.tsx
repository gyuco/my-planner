import { useEffect, useRef, useState } from "react";
import { ApiRequestError, createVoiceSession, getVoiceStatus } from "../api";
import { useI18n } from "../i18n";
import { LiveVoiceSession, type TranscriptEntry, type VoicePhase } from "../lib/voice/liveSession";
import type { VoiceToolHost } from "../lib/voice/tools";
import { baseStatusLabels } from "../lib/statuses";
import { MicIcon } from "./Icons";

interface VoiceAssistantProps {
  host: Omit<VoiceToolHost, "baseStatusLabels">;
}

const LANGUAGE_NAMES: Record<string, string> = { it: "italiano", en: "English", es: "español" };

/**
 * Pulsante microfono nella topbar: apre una conversazione vocale con Gemini
 * Live. Solo per gli admin, e solo se l'assistente e' configurato.
 */
export function VoiceAssistant({ host }: VoiceAssistantProps) {
  const { t, locale } = useI18n();
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("closed");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef<LiveVoiceSession | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVoiceStatus()
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(false));
  }, []);

  // Chiude la sessione (microfono incluso) se il componente sparisce.
  useEffect(() => () => sessionRef.current?.stop(), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [transcript]);

  const running = phase === "connecting" || phase === "listening" || phase === "speaking" || phase === "working";

  async function start() {
    setError(null);
    setTranscript([]);
    setOpen(true);
    // L'host passa da un ref: la sessione vede sempre progetto/task correnti.
    const session = new LiveVoiceSession(
      createVoiceSession,
      {
        getContext: () => hostRef.current.getContext(),
        onDataChanged: () => hostRef.current.onDataChanged(),
        onOpenTask: (taskId, projectId) => hostRef.current.onOpenTask(taskId, projectId),
        baseStatusLabels: baseStatusLabels(t),
      },
      LANGUAGE_NAMES[locale] ?? "English",
      { actionPrefix: (name) => t.voice.actions[name as keyof typeof t.voice.actions] ?? name },
      {
        onPhase: (next, reason) => {
          setPhase(next);
          if (next === "error") setError(reason ?? null);
          if (next === "closed" || next === "error") setLevel(0);
        },
        onTranscript: setTranscript,
        onLevel: setLevel,
      },
    );
    sessionRef.current = session;
    try {
      await session.start();
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setError(t.voice.micDenied);
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError(t.voice.micMissing);
      } else if (err instanceof ApiRequestError) {
        setError(err.message);
      }
    }
  }

  function stop() {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }

  if (!available) return null;

  const phaseLabel =
    phase === "connecting"
      ? t.voice.connecting
      : phase === "listening"
        ? t.voice.listening
        : phase === "speaking"
          ? t.voice.speaking
          : phase === "working"
            ? t.voice.working
            : phase === "error"
              ? t.voice.errorTitle
              : t.voice.ended;

  return (
    <div className="voice">
      <button
        type="button"
        className={`topbar-icon-btn voice-button${running ? " active" : ""}`}
        onClick={() => (running ? stop() : void start())}
        aria-label={running ? t.voice.stop : t.voice.start}
        aria-pressed={running}
        title={running ? t.voice.stop : t.voice.start}
        style={running ? ({ "--voice-level": level.toFixed(2) } as React.CSSProperties) : undefined}
      >
        <MicIcon />
      </button>

      {open && (
        <div className="voice-panel" role="dialog" aria-label={t.voice.title}>
          <div className="notifications-header">
            <h2>{t.voice.title}</h2>
            <button
              type="button"
              className="notifications-close"
              onClick={() => {
                stop();
                setOpen(false);
              }}
              aria-label={t.common.close}
            >
              ×
            </button>
          </div>

          <p className={`voice-status voice-status-${phase}`} aria-live="polite">
            <span className="voice-dot" aria-hidden="true" />
            {phaseLabel}
          </p>
          {error && <p className="login-error voice-error">{error}</p>}

          <div className="voice-transcript" ref={listRef}>
            {transcript.length === 0 && running && <p className="drawer-empty">{t.voice.hint}</p>}
            {transcript.map((entry) => (
              <p key={entry.id} className={`voice-line voice-line-${entry.role}${entry.ok === false ? " failed" : ""}`}>
                {entry.role === "action" ? `${entry.ok ? "✓" : "✗"} ${entry.text}` : entry.text}
              </p>
            ))}
          </div>

          <div className="voice-actions">
            {running ? (
              <button type="button" onClick={stop}>
                {t.voice.stop}
              </button>
            ) : (
              <button type="button" onClick={() => void start()}>
                {t.voice.restart}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
