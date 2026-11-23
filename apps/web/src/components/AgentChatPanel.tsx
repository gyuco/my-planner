import { useCallback, useEffect, useState } from "react";
import type { AgentChat, AgentChatStatus } from "@my-planner/core";
import { ApiRequestError, createAgentChat, listAgentChats } from "../api";
import { useI18n } from "../i18n";
import { AgentChatView } from "./AgentChatView";
import { XIcon } from "./Icons";

interface AgentChatPanelProps {
  projectId: string;
  onClose: () => void;
}

/**
 * Pannello laterale con le chat di progetto (non legate a un task): elenco,
 * nuova chat e la chat selezionata. Aperto dal pulsante nella toolbar della
 * board, solo per gli admin con l'agente configurato.
 */
export function AgentChatPanel({ projectId, onClose }: AgentChatPanelProps) {
  const { t, formatDateTime } = useI18n();
  const [chats, setChats] = useState<AgentChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await listAgentChats(projectId, { scope: "project" });
      setChats(list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    setLoading(true);
    setSelectedId(null);
    void load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || starting) return;
    setStarting(true);
    setError(null);
    try {
      const created = await createAgentChat(projectId, { text: body });
      setChats((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      setSelectedId(created.id);
      setText("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    } finally {
      setStarting(false);
    }
  }

  const handleStatusChange = useCallback(
    (status: AgentChatStatus) => {
      if (!selectedId) return;
      setChats((prev) => prev.map((c) => (c.id === selectedId && c.status !== status ? { ...c, status } : c)));
    },
    [selectedId],
  );

  const selected = chats.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="agent-panel-overlay" onClick={onClose}>
      <aside
        className="agent-panel"
        role="dialog"
        aria-label={t.agentChat.panelTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agent-panel-header">
          {selectedId ? (
            <button type="button" className="agent-panel-back" onClick={() => setSelectedId(null)}>
              ← {t.agentChat.back}
            </button>
          ) : (
            <h2>{t.agentChat.panelTitle}</h2>
          )}
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            title={t.agentChat.close}
            aria-label={t.agentChat.close}
          >
            <XIcon />
          </button>
        </div>

        {selectedId ? (
          <div className="agent-panel-body">
            {selected && <h3 className="agent-panel-chat-title">{selected.title}</h3>}
            <AgentChatView key={selectedId} chatId={selectedId} onStatusChange={handleStatusChange} />
          </div>
        ) : (
          <div className="agent-panel-body">
            <form className="agent-chat-input agent-chat-start" onSubmit={handleStart}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={t.agentChat.newChatPlaceholder}
                rows={2}
                maxLength={20000}
              />
              <button type="submit" disabled={starting || !text.trim()}>
                {starting ? t.agentChat.starting : t.agentChat.newChat}
              </button>
            </form>
            {error && <p className="login-error">{error}</p>}
            {loading ? (
              <p className="ai-hint">{t.agentChat.loading}</p>
            ) : chats.length === 0 ? (
              <p className="ai-hint">{t.agentChat.empty}</p>
            ) : (
              <ul className="agent-chat-list">
                {chats.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="agent-chat-list-item" onClick={() => setSelectedId(c.id)}>
                      <span className="agent-chat-list-title">{c.title}</span>
                      <span className="agent-chat-list-meta">
                        {formatDateTime(c.createdAt)}
                        {c.createdByName && ` · ${t.agentChat.createdBy.replace("{name}", c.createdByName)}`}
                      </span>
                      <span className={`agent-chat-list-status agent-status-${c.status}`}>
                        {t.agentChat.chatStatus[c.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
