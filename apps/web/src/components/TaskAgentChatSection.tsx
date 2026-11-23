import { useCallback, useEffect, useState } from "react";
import type { AgentChat, AgentChatStatus } from "@my-planner/core";
import { ApiRequestError, createAgentChat, listAgentChats } from "../api";
import { useI18n } from "../i18n";
import { AgentChatView } from "./AgentChatView";

/** Chat da mostrare per un task: la prima non terminata, altrimenti la piu' recente. */
function pickChat(chats: AgentChat[]): AgentChat | null {
  const open = chats.find((c) => c.status !== "terminated");
  if (open) return open;
  return chats.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * Sezione "Chat agente" nel drawer del task (solo admin, solo con agente
 * configurato: lo decide il chiamante). Mostra la chat del task o un input
 * per avviarne una.
 */
export function TaskAgentChatSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useI18n();
  const [chat, setChat] = useState<AgentChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<AgentChatStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const chats = await listAgentChats(projectId, { taskId });
      setChat(pickChat(chats));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId, t]);

  useEffect(() => {
    setLoading(true);
    setChat(null);
    setStatus(null);
    void load();
  }, [load]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || starting) return;
    setStarting(true);
    setError(null);
    try {
      const created = await createAgentChat(projectId, { taskId, text: body });
      setChat(created);
      setStatus(created.status);
      setText("");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        // Il task ha gia' una chat aperta (es. avviata da un altro admin): la si mostra.
        await load();
      }
      setError(err instanceof ApiRequestError ? err.message : t.agentChat.loadError);
    } finally {
      setStarting(false);
    }
  }

  const canStart = !chat || (status ?? chat.status) === "terminated";

  return (
    <section className="drawer-section agent-chat-section" aria-label={t.agentChat.title}>
      <h3>{t.agentChat.title}</h3>
      {loading ? (
        <p className="ai-hint">{t.agentChat.loading}</p>
      ) : (
        <>
          {chat && <AgentChatView key={chat.id} chatId={chat.id} onStatusChange={setStatus} />}
          {canStart && (
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
                placeholder={t.agentChat.startPlaceholder}
                rows={2}
                maxLength={20000}
              />
              <button type="submit" disabled={starting || !text.trim()}>
                {starting ? t.agentChat.starting : chat ? t.agentChat.newChat : t.agentChat.start}
              </button>
            </form>
          )}
        </>
      )}
      {error && <p className="login-error">{error}</p>}
    </section>
  );
}
