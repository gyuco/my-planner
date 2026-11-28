import { useEffect, useRef } from "react";
import { getToken } from "../auth";

/**
 * Board in tempo reale: un WebSocket per progetto verso
 * `/api/realtime/projects/:id` (Durable Object sul Worker, vedi
 * apps/server/src/cf/realtime.ts). Ogni avviso `board.changed` fa ricaricare
 * la board via REST, raggruppando gli avvisi ravvicinati.
 *
 * Il token viaggia come secondo sottoprotocollo: l'API WebSocket del browser
 * non permette l'header Authorization.
 *
 * Se il server non offre il tempo reale (stack Node/Docker, nessun Durable
 * Object) la connessione fallisce e viene ritentata con un'attesa crescente
 * fino a 5 minuti: la board resta utilizzabile, solo senza aggiornamenti
 * automatici.
 */

const PROTOCOL = "my-planner.v1";
const DEBOUNCE_MS = 300;
const PING_MS = 30_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 5 * 60_000;

interface BoardChangeMessage {
  type: "board.changed";
  projectId: string;
  taskId: string | null;
  event: string;
}

function realtimeUrl(projectId: string): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/realtime/projects/${encodeURIComponent(projectId)}`;
}

/** Connessione a un progetto con riconnessione automatica. Ritorna la funzione di chiusura. */
function connect(projectId: string, onMessage: (msg: BoardChangeMessage) => void, onReconnect: () => void): () => void {
  let socket: WebSocket | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = MIN_RETRY_MS;
  let disposed = false;
  let wasOpen = false;

  const open = () => {
    const token = getToken();
    if (disposed || !token) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(realtimeUrl(projectId), [PROTOCOL, token]);
    } catch {
      schedule();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      delay = MIN_RETRY_MS;
      // Durante la disconnessione possono essere andati persi degli avvisi.
      if (wasOpen) onReconnect();
      wasOpen = true;
      ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, PING_MS);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === "pong") return;
      try {
        const msg = JSON.parse(e.data) as BoardChangeMessage;
        if (msg?.type === "board.changed") onMessage(msg);
      } catch {
        // Messaggio non riconosciuto: ignorato.
      }
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (socket === ws) socket = null;
      schedule();
    };
  };

  const schedule = () => {
    if (disposed) return;
    clearTimeout(retry);
    retry = setTimeout(open, delay);
    delay = Math.min(delay * 2, MAX_RETRY_MS);
  };

  // Tornando sulla scheda (o online) dopo una disconnessione si riprova subito.
  const wake = () => {
    if (disposed || socket || document.visibilityState !== "visible") return;
    delay = MIN_RETRY_MS;
    clearTimeout(retry);
    open();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  open();

  return () => {
    disposed = true;
    clearTimeout(retry);
    clearInterval(ping);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
    if (socket) {
      socket.onclose = null;
      socket.close(1000);
    }
  };
}

/**
 * Tiene aperti i WebSocket dei progetti indicati e chiama `onChange` (al
 * massimo una volta ogni DEBOUNCE_MS) quando una delle board cambia.
 */
export function useRealtimeBoard(projectIds: string[], onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = [...new Set(projectIds)].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trigger = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS);
    };
    const closers = key.split(",").map((id) => connect(id, trigger, trigger));
    return () => {
      clearTimeout(timer);
      closers.forEach((close) => close());
    };
  }, [key]);
}
