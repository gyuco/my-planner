import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationItem, TaskStatus } from "@my-planner/core";
import { getNotifications, markNotificationsRead } from "../api";
import { useI18n } from "../i18n";

const POLL_INTERVAL_MS = 25_000;
const MAX_ITEMS = 50;

interface NotificationsBellProps {
  /** Apre il drawer del task referenziato dalla notifica (anche di un altro progetto). */
  onOpenTask: (taskId: string, projectId: string) => void;
}

/** Unisce gli eventi nuovi a quelli gia' mostrati, senza duplicati e dal piu' recente. */
function mergeItems(previous: NotificationItem[], incoming: NotificationItem[]): NotificationItem[] {
  const byId = new Map<number, NotificationItem>();
  for (const item of [...previous, ...incoming]) byId.set(item.id, item);
  return Array.from(byId.values())
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_ITEMS);
}

/** Sostituisce i segnaposto `{nome}` nei messaggi i18n. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

/**
 * Campanella delle notifiche in-app.
 *
 * Trasporto volutamente a polling (25s, solo con tab visibile): il project
 * gira sia su Fastify sia su Workers/D1, dove WebSocket/SSE richiederebbero
 * Durable Objects o connessioni appese al request scope di D1. Il polling
 * riusa lo stesso endpoint sia per il badge sia per la lista.
 */
export function NotificationsBell({ onOpenTask }: NotificationsBellProps) {
  const { t, formatDateTime } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Il polling deve vedere lo stato "pannello aperto" senza ricreare l'intervallo
  // ad ogni toggle: un ref evita di resettare il timer.
  const openRef = useRef(open);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Chiusura su click fuori o Escape. Non si usa un backdrop in posizione
  // `fixed`: la topbar ha `backdrop-filter`, che farebbe da containing block
  // per i discendenti fixed limitandoli all'altezza della topbar.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
        setItems([]);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setItems([]);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const statusLabel: Record<TaskStatus, string> = {
    draft: t.board.draft,
    todo: t.board.todo,
    in_progress: t.board.inProgress,
    testing: t.board.testing,
    done: t.board.done,
  };

  const refresh = useCallback(
    async (markRead: boolean) => {
      try {
        const data = await getNotifications(30);
        setUnreadCount(data.unreadCount);
        setItems((prev) => mergeItems(prev, data.items));
        setError(null);

        // Con il pannello aperto gli eventi appena arrivati sono gia' sotto gli
        // occhi dell'utente: si sposta subito il cursore (una sola scrittura,
        // solo quando c'e' davvero qualcosa di nuovo).
        if (markRead && data.serverCursor > data.lastSeenEventId) {
          const res = await markNotificationsRead(data.serverCursor);
          if (res.lastSeenEventId >= data.serverCursor) setUnreadCount(0);
        }
      } catch {
        // Il 401 e' gia' gestito da apiFetch (logout). Per gli altri errori il
        // badge resta invariato e lo si segnala nel pannello.
        setError(t.notifications.loadError);
      }
    },
    [t],
  );

  useEffect(() => {
    refresh(false);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh(openRef.current);
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(openRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  function closePanel() {
    setOpen(false);
    setItems([]);
  }

  function togglePanel() {
    if (open) {
      closePanel();
    } else {
      setOpen(true);
      // Fetch immediato: il pannello mostra gli eventi accumulati dall'ultima
      // lettura e poi sposta il cursore.
      refresh(true);
    }
  }

  function handleItem(item: NotificationItem) {
    if (!item.taskId) return;
    onOpenTask(item.taskId, item.projectId);
    closePanel();
  }

  function messageFor(item: NotificationItem): string {
    const actor =
      item.actorName ?? (item.actorType === "mcp" ? t.notifications.viaMcp : t.notifications.someone);
    const vars = {
      actor,
      title: item.taskTitle,
      from: item.from ? statusLabel[item.from] : "",
      to: item.to ? statusLabel[item.to] : "",
    };
    if (item.type === "task.created") return fill(t.notifications.taskCreated, vars);
    if (item.type === "task.status_changed") return fill(t.notifications.statusChanged, vars);
    return fill(t.notifications.commented, vars);
  }

  function dotClass(item: NotificationItem): string {
    if (item.type === "task.created") return "notifications-dot-created";
    if (item.type === "task.status_changed") return "notifications-dot-status";
    return "notifications-dot-comment";
  }

  return (
    <div className="notifications" ref={containerRef}>
      <button
        type="button"
        className="notifications-trigger"
        aria-label={t.notifications.open}
        aria-expanded={open}
        title={t.notifications.open}
        onClick={togglePanel}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className="notifications-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notifications-panel" role="dialog" aria-label={t.notifications.title}>
          <div className="notifications-header">
            <h2>{t.notifications.title}</h2>
            <button
              type="button"
              className="notifications-close"
              aria-label={t.notifications.close}
              onClick={closePanel}
            >
              ×
            </button>
          </div>

          {error && <p className="notifications-error">{error}</p>}

          {items.length === 0 ? (
            <p className="notifications-empty">{t.notifications.empty}</p>
          ) : (
            <ul className="notifications-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="notifications-item" onClick={() => handleItem(item)}>
                    <span className={`notifications-dot ${dotClass(item)}`} aria-hidden="true" />
                    <span className="notifications-content">
                      <span className="notifications-text">{messageFor(item)}</span>
                      {item.type === "comment.created" && item.excerpt && (
                        <span className="notifications-excerpt">{item.excerpt}</span>
                      )}
                      <span className="notifications-meta">
                        {item.projectName} · {formatDateTime(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
