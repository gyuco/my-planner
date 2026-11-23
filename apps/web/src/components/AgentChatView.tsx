import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChat, AgentChatEvent, AgentChatStatus } from "@my-planner/core";
import {
  ApiRequestError,
  confirmAgentChatTool,
  getAgentChat,
  interruptAgentChat,
  listAgentChatEvents,
  sendAgentChatMessage,
  streamAgentChat,
} from "../api";
import { useI18n } from "../i18n";
import { renderMarkdown } from "../lib/markdown";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const INPUT_PREVIEW_CHARS = 90;

/** Attende ms millisecondi, interrompendosi subito se il signal viene abortito. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** Unisce due liste di eventi senza duplicati (per id), mantenendo l'ordine della prima. */
function mergeEvents(base: AgentChatEvent[], extra: AgentChatEvent[]): AgentChatEvent[] {
  const seen = new Set(base.map((e) => e.id));
  const out = base.slice();
  for (const e of extra) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

function isBudgetStop(stopReason: string | undefined): boolean {
  return Boolean(stopReason && /budget/i.test(stopReason));
}

function formatUsd(cents: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

type Item =
  | { kind: "user"; event: AgentChatEvent }
  | { kind: "agent"; event: AgentChatEvent }
  | { kind: "preview"; key: string; text: string }
  | { kind: "tool"; event: AgentChatEvent; pending: boolean }
  | { kind: "result"; event: AgentChatEvent }
  | { kind: "error"; event: AgentChatEvent };

interface AgentChatViewProps {
  chatId: string;
  /** Notificato quando cambia lo stato della chat (es. per aggiornare una lista). */
  onStatusChange?: (status: AgentChatStatus) => void;
}

/**
 * Chat con l'agente del progetto: carica gli eventi, poi segue lo stream SSE
 * (con riconnessione e backoff), mostra messaggi, anteprima live, chiamate
 * agli strumenti con approvazione, stato, costo e casella di input.
 */
export function AgentChatView({ chatId, onStatusChange }: AgentChatViewProps) {
  const { t, dateLocale } = useI18n();
  const [chat, setChat] = useState<AgentChat | null>(null);
  const [events, setEvents] = useState<AgentChatEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Record<string, "allow" | "deny">>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Caricamento eventi + stream, con riconnessione (refetch + nuovo stream) e backoff.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let terminated = false;
    // Dopo il primo caricamento riuscito gli errori di rete diventano solo "riconnessione".
    let loadedOnce = false;
    setChat(null);
    setEvents([]);
    setLoaded(false);
    setLoadError(null);
    setReconnecting(false);
    setAnswered({});
    setActionError(null);

    function onEvent(event: AgentChatEvent) {
      if (event.type === "status" && event.status === "terminated") terminated = true;
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
    }

    (async () => {
      let attempt = 0;
      while (!signal.aborted) {
        try {
          const [fetched, info] = await Promise.all([listAgentChatEvents(chatId), getAgentChat(chatId)]);
          if (signal.aborted) return;
          setEvents((prev) => mergeEvents(fetched, prev));
          setChat(info);
          loadedOnce = true;
          setLoaded(true);
          setLoadError(null);
          if (info.status === "terminated" || fetched.some((e) => e.type === "status" && e.status === "terminated")) {
            terminated = true;
          }
          if (terminated) {
            setReconnecting(false);
            return;
          }
          setReconnecting(false);
          await streamAgentChat(
            chatId,
            (event) => {
              attempt = 0;
              onEvent(event);
            },
            signal,
          );
        } catch (err) {
          if (signal.aborted) return;
          if (err instanceof ApiRequestError && [401, 403, 404].includes(err.status)) {
            setLoadError(err.message);
            return;
          }
          if (!loadedOnce) setLoadError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
        }
        if (signal.aborted || terminated) {
          if (terminated && !signal.aborted) {
            // Ultimo aggiornamento dello stato della chat dopo la chiusura.
            getAgentChat(chatId)
              .then((info) => !signal.aborted && setChat(info))
              .catch(() => undefined);
          }
          return;
        }
        setReconnecting(true);
        await sleep(Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt), signal);
        attempt += 1;
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Stato corrente: ultimo evento "status", altrimenti quello della chat.
  const lastStatus = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].type === "status" && events[i].status) return events[i];
    }
    return null;
  }, [events]);
  const status: AgentChatStatus = lastStatus?.status ?? chat?.status ?? "idle";
  const stopReason = lastStatus?.stopReason;

  useEffect(() => {
    onStatusChangeRef.current?.(status);
  }, [status]);

  const costCents = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].type === "usage" && typeof events[i].costCents === "number") return events[i].costCents!;
    }
    return null;
  }, [events]);

  const items = useMemo<Item[]>(() => {
    const finalIds = new Set(events.filter((e) => e.type === "agent_message").map((e) => e.id));
    const previews = new Map<string, string>();
    for (const e of events) {
      if ((e.type === "agent_delta_start" || e.type === "agent_delta") && e.messageId && !finalIds.has(e.messageId)) {
        previews.set(e.messageId, (previews.get(e.messageId) ?? "") + (e.text ?? ""));
      }
    }
    const out: Item[] = [];
    const placed = new Set<string>();
    events.forEach((e, index) => {
      switch (e.type) {
        case "user_message":
          out.push({ kind: "user", event: e });
          break;
        case "agent_message":
          out.push({ kind: "agent", event: e });
          break;
        case "agent_delta_start":
        case "agent_delta":
          if (e.messageId && previews.has(e.messageId) && !placed.has(e.messageId)) {
            placed.add(e.messageId);
            out.push({ kind: "preview", key: e.messageId, text: previews.get(e.messageId) ?? "" });
          }
          break;
        case "tool_use": {
          // In attesa finche' non arriva un evento che indica che la sessione e' ripartita.
          const later = events.slice(index + 1);
          const resolved = later.some(
            (l) =>
              l.type === "tool_result" ||
              l.type === "agent_message" ||
              l.type === "agent_delta_start" ||
              (l.type === "status" && (l.status === "running" || l.status === "terminated")),
          );
          out.push({ kind: "tool", event: e, pending: Boolean(e.needsApproval) && !resolved });
          break;
        }
        case "tool_result":
          out.push({ kind: "result", event: e });
          break;
        case "error":
          out.push({ kind: "error", event: e });
          break;
        default:
          break;
      }
    });
    return out;
  }, [events]);

  const awaitingApproval = status !== "terminated" && items.some((i) => i.kind === "tool" && i.pending && !answered[i.event.id]);
  const running = status === "running" || status === "rescheduling";

  let statusText: string;
  if (status === "terminated") statusText = t.agentChat.statusLine.ended;
  else if (awaitingApproval) statusText = t.agentChat.statusLine.approval;
  else if (running) statusText = t.agentChat.statusLine.working;
  else if (isBudgetStop(stopReason)) statusText = t.agentChat.statusLine.budget;
  else statusText = t.agentChat.statusLine.waiting;

  // Scroll automatico in fondo, solo se l'utente era gia' in fondo.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setActionError(null);
    try {
      await sendAgentChatMessage(chatId, body);
      setText("");
      stickToBottom.current = true;
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    } finally {
      setSending(false);
    }
  }, [chatId, sending, t, text]);

  async function handleStop() {
    setActionError(null);
    try {
      await interruptAgentChat(chatId);
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    }
  }

  async function handleConfirm(toolUseId: string, result: "allow" | "deny") {
    setAnswering(toolUseId);
    setActionError(null);
    try {
      await confirmAgentChatTool(chatId, { toolUseId, result });
      setAnswered((prev) => ({ ...prev, [toolUseId]: result }));
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    } finally {
      setAnswering(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (loadError && !loaded) {
    return <div className="board-error agent-chat-error">{loadError}</div>;
  }
  if (!loaded) {
    return <p className="ai-hint agent-chat-loading">{t.agentChat.loading}</p>;
  }

  return (
    <div className="agent-chat">
      <div className="agent-chat-messages" ref={listRef} onScroll={handleScroll}>
        {items.map((item) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={item.event.id} className="agent-bubble agent-bubble-user">
                  <span className="agent-bubble-author">{t.agentChat.you}</span>
                  <div className="agent-bubble-plain">{item.event.text}</div>
                </div>
              );
            case "agent":
              return (
                <div key={item.event.id} className="agent-bubble agent-bubble-agent">
                  <span className="agent-bubble-author">{t.agentChat.agent}</span>
                  <div
                    className="comment-body agent-bubble-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.event.text ?? "") }}
                  />
                </div>
              );
            case "preview":
              return (
                <div key={`preview-${item.key}`} className="agent-bubble agent-bubble-agent agent-bubble-preview">
                  <span className="agent-bubble-author">{t.agentChat.agent}</span>
                  <div className="agent-bubble-plain">
                    {item.text}
                    <span className="agent-typing" aria-hidden="true" />
                  </div>
                </div>
              );
            case "tool": {
              const e = item.event;
              const answer = answered[e.id];
              const preview = (e.toolInput ?? "").replace(/\s+/g, " ").slice(0, INPUT_PREVIEW_CHARS);
              return (
                <div key={e.id} className={`agent-tool${e.isError ? " agent-tool-error" : ""}`}>
                  <details>
                    <summary>
                      <span className="agent-tool-name">{e.toolName ?? t.agentChat.tool}</span>
                      {preview && <span className="agent-tool-preview">{preview}</span>}
                      {e.isError && <span className="agent-tool-flag">{t.agentChat.toolError}</span>}
                      {answer && (
                        <span className="agent-tool-flag agent-tool-answer">
                          {answer === "allow" ? t.agentChat.allowed : t.agentChat.denied}
                        </span>
                      )}
                    </summary>
                    {e.toolInput && <pre className="agent-tool-input">{e.toolInput}</pre>}
                  </details>
                  {item.pending && !answer && status !== "terminated" && (
                    <div className="agent-tool-actions">
                      <button type="button" onClick={() => handleConfirm(e.id, "allow")} disabled={answering === e.id}>
                        {t.agentChat.allow}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => handleConfirm(e.id, "deny")}
                        disabled={answering === e.id}
                      >
                        {t.agentChat.deny}
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            case "result": {
              const e = item.event;
              const preview = (e.text ?? "").replace(/\s+/g, " ").slice(0, INPUT_PREVIEW_CHARS);
              return (
                <div key={e.id} className={`agent-tool agent-tool-result${e.isError ? " agent-tool-error" : ""}`}>
                  <details>
                    <summary>
                      <span className="agent-tool-name">{t.agentChat.toolResult}</span>
                      {preview && <span className="agent-tool-preview">{preview}</span>}
                      {e.isError && <span className="agent-tool-flag">{t.agentChat.toolError}</span>}
                    </summary>
                    {e.text && <pre className="agent-tool-input">{e.text}</pre>}
                  </details>
                </div>
              );
            }
            case "error":
              return (
                <p key={item.event.id} className="ai-failure">
                  {t.agentChat.errorEvent}: {item.event.text}
                </p>
              );
            default:
              return null;
          }
        })}
      </div>

      <div className="agent-chat-status">
        <span className={`agent-status-dot agent-status-${awaitingApproval ? "approval" : status}`} aria-hidden="true" />
        <span className="agent-status-text">{statusText}</span>
        {running && (
          <button type="button" className="agent-chat-stop" onClick={handleStop}>
            {t.agentChat.stop}
          </button>
        )}
        {costCents !== null && (
          <span className="agent-chat-cost">{t.agentChat.cost.replace("{amount}", formatUsd(costCents, dateLocale))}</span>
        )}
        {chat?.consoleUrl && (
          <a className="agent-chat-console" href={chat.consoleUrl} target="_blank" rel="noreferrer">
            {t.agentChat.openConsole}
          </a>
        )}
      </div>
      {reconnecting && <p className="ai-hint">{t.agentChat.reconnecting}</p>}
      {actionError && <p className="login-error">{actionError}</p>}

      <form
        className="agent-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={status === "terminated" ? t.agentChat.ended : t.agentChat.inputPlaceholder}
          rows={2}
          maxLength={20000}
          disabled={status === "terminated"}
        />
        <button type="submit" disabled={sending || !text.trim() || status === "terminated"}>
          {sending ? t.agentChat.sending : t.agentChat.send}
        </button>
      </form>
    </div>
  );
}
