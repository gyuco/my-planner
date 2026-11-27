import { useEffect, useRef, useState } from "react";
import { ApiRequestError, createVoiceSession } from "../api";
import { useI18n } from "../i18n";
import { AssistantAvatar } from "../components/AssistantAvatar";
import { MicIcon } from "../components/Icons";
import { renderMarkdown } from "../lib/markdown";
import { baseStatusLabels } from "../lib/statuses";
import { LiveVoiceSession, type MicState, type TranscriptEntry, type VoicePhase } from "../lib/voice/liveSession";
import type { VoiceToolHost } from "../lib/voice/tools";

interface AssistantPageProps {
  host: Omit<VoiceToolHost, "baseStatusLabels" | "onShow">;
}

const LANGUAGE_NAMES: Record<string, string> = { it: "italiano", en: "English", es: "español" };
/** In questa vista si chiude dopo 3 minuti di silenzio (90 s nel pulsante rapido). */
const IDLE_TIMEOUT_MS = 3 * 60_000;

/**
 * Assistente a schermo intero (solo admin): sagoma animata, voce e testo,
 * report sui progetti mostrati a schermo dallo strumento show_on_screen.
 */
export function AssistantPage({ host }: AssistantPageProps) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<VoicePhase>("closed");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [mic, setMic] = useState<MicState>("unavailable");
  const [screen, setScreen] = useState<{ title: string; markdown: string } | null>(null);
  const [draft, setDraft] = useState("");
  const sessionRef = useRef<LiveVoiceSession | null>(null);
  const inputLevel = useRef(0);
  const hostRef = useRef(host);
  hostRef.current = host;
  const listRef = useRef<HTMLDivElement>(null);

  const running = phase === "connecting" || phase === "listening" || phase === "speaking" || phase === "working";

  useEffect(() => () => sessionRef.current?.stop(), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  function start(options: { muted?: boolean; firstText?: string } = {}) {
    sessionRef.current?.stop();
    setError(null);
    const session = new LiveVoiceSession(
      createVoiceSession,
      {
        getContext: () => hostRef.current.getContext(),
        onDataChanged: () => hostRef.current.onDataChanged(),
        onOpenTask: (taskId, projectId) => hostRef.current.onOpenTask(taskId, projectId),
        baseStatusLabels: baseStatusLabels(t),
        onShow: (title, markdown) => setScreen({ title, markdown }),
      },
      LANGUAGE_NAMES[locale] ?? "English",
      { actionPrefix: (name) => t.voice.actions[name as keyof typeof t.voice.actions] ?? name },
      {
        onPhase: (next, reason) => {
          setPhase(next);
          if (next === "error") setError(reason ?? null);
          if (next === "closed" || next === "error") inputLevel.current = 0;
        },
        onTranscript: setTranscript,
        onLevel: (level) => {
          inputLevel.current = level;
        },
        onMic: setMic,
      },
      { idleTimeoutMs: IDLE_TIMEOUT_MS, startMuted: options.muted },
    );
    sessionRef.current = session;
    // Il testo va accodato prima di start(): parte appena la sessione e' pronta.
    if (options.firstText) session.sendText(options.firstText);
    session.start().catch((err) => {
      if (err instanceof ApiRequestError) setError(err.message);
    });
  }

  function stop() {
    sessionRef.current?.stop();
  }

  function submitText(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setDraft("");
    if (running && sessionRef.current) sessionRef.current.sendText(clean);
    else start({ muted: true, firstText: clean });
  }

  function toggleMic() {
    const session = sessionRef.current;
    if (!session || mic === "unavailable") return;
    session.setMuted(mic === "on");
  }

  const phaseLabel =
    phase === "connecting"
      ? t.voice.connecting
      : phase === "listening"
        ? mic === "on"
          ? t.voice.listening
          : t.assistant.waitingText
        : phase === "speaking"
          ? t.voice.speaking
          : phase === "working"
            ? t.voice.working
            : phase === "error"
              ? t.voice.errorTitle
              : transcript.length > 0
                ? t.voice.ended
                : t.assistant.idle;

  return (
    <div className="assistant-page">
      <section className="assistant-stage">
        <AssistantAvatar
          phase={phase}
          levels={() => ({ output: sessionRef.current?.outputLevel() ?? 0, input: inputLevel.current })}
        />
        <p className={`assistant-phase voice-status-${phase}`} aria-live="polite">
          <span className="voice-dot" aria-hidden="true" />
          {phaseLabel}
        </p>
        {error && <p className="login-error assistant-error">{error}</p>}
        {running && mic === "unavailable" && <p className="drawer-empty">{t.assistant.micUnavailable}</p>}
        <div className="assistant-controls">
          {running ? (
            <>
              <button
                type="button"
                className={`assistant-mic${mic === "on" ? " on" : ""}`}
                onClick={toggleMic}
                disabled={mic === "unavailable"}
                aria-pressed={mic === "on"}
              >
                <MicIcon />
                {mic === "on" ? t.assistant.micOff : t.assistant.micOn}
              </button>
              <button type="button" onClick={stop}>
                {t.voice.stop}
              </button>
            </>
          ) : (
            <button type="button" className="assistant-start" onClick={() => start()}>
              <MicIcon />
              {transcript.length > 0 ? t.voice.restart : t.assistant.start}
            </button>
          )}
        </div>
      </section>

      <section className="assistant-side">
        {screen && (
          <article className="assistant-screen">
            <header>
              <h2>{screen.title}</h2>
              <button
                type="button"
                className="notifications-close"
                onClick={() => setScreen(null)}
                aria-label={t.assistant.closeScreen}
              >
                ×
              </button>
            </header>
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(screen.markdown) }} />
          </article>
        )}

        <div className="assistant-transcript" ref={listRef}>
          {transcript.length === 0 && (
            <div className="assistant-intro">
              <p>{t.assistant.intro}</p>
              <div className="assistant-suggestions">
                {t.assistant.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => submitText(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {transcript.map((entry) => (
            <p key={entry.id} className={`voice-line voice-line-${entry.role}${entry.ok === false ? " failed" : ""}`}>
              {entry.role === "action" ? `${entry.ok ? "✓" : "✗"} ${entry.text}` : entry.text}
            </p>
          ))}
        </div>

        <form
          className="assistant-input"
          onSubmit={(e) => {
            e.preventDefault();
            submitText(draft);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.assistant.placeholder}
            aria-label={t.assistant.placeholder}
            maxLength={2000}
          />
          <button type="submit" disabled={!draft.trim()}>
            {t.assistant.send}
          </button>
        </form>
      </section>
    </div>
  );
}
