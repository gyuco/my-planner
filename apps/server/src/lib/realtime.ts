/**
 * Board in tempo reale: ogni modifica a un task (REST o MCP) pubblica un
 * avviso ai client che hanno la board del progetto aperta.
 *
 * Il service layer chiama solo `publishBoardChange`; il trasporto e' un
 * provider impostato dal runtime, come per le email in background:
 *  - Worker Cloudflare: un Durable Object per progetto inoltra l'avviso ai
 *    WebSocket collegati (vedi src/cf/realtime.ts);
 *  - Node/Docker: nessun provider, l'avviso non parte e la UI resta com'e'
 *    (si aggiorna al reload o alla prossima azione).
 *
 * L'avviso non contiene dati del task (niente titoli): dice solo "la board di
 * questo progetto e' cambiata". Il client ricarica la board via REST, che
 * applica i permessi correnti.
 */

export const REALTIME_PROTOCOL = "my-planner.v1";

export interface BoardChangeMessage {
  type: "board.changed";
  projectId: string;
  taskId: string | null;
  /** Tipo dell'evento di attivita' (es. task.status_changed) o "task.reordered". */
  event: string;
  actorType: "user" | "mcp" | "system";
}

export type RealtimePublisher = (message: BoardChangeMessage) => void;

let publisher: RealtimePublisher | null = null;

export function setRealtimePublisher(p: RealtimePublisher | null) {
  publisher = p;
}

/** Best-effort: non lancia mai, l'azione principale e' gia' andata a buon fine. */
export function publishBoardChange(message: BoardChangeMessage): void {
  if (!publisher) return;
  try {
    publisher(message);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[my-planner] impossibile pubblicare l'aggiornamento della board", err);
  }
}
