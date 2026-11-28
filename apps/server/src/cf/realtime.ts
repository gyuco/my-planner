import type {
  DurableObjectNamespace,
  DurableObjectState,
  WebSocket as CfWebSocket,
} from "@cloudflare/workers-types";
import { verifyAccessToken } from "./jwt.js";
import { getAuthUser, assertProjectAccess } from "../services/userService.js";
import { prisma } from "../lib/prisma.js";
import { REALTIME_PROTOCOL, type BoardChangeMessage } from "../lib/realtime.js";

/**
 * Board in tempo reale sul Worker: un Durable Object per progetto
 * (`idFromName(projectId)`) tiene i WebSocket dei client con la board aperta
 * e inoltra loro gli avvisi pubblicati da `emitEvent` (lib/realtime.ts).
 *
 * I WebSocket usano la Hibernation API (`ctx.acceptWebSocket`): mentre nessun
 * avviso passa, il DO puo' essere sfrattato dalla memoria senza chiudere le
 * connessioni e senza consumare durata. Il ping di keepalive del client riceve
 * la risposta automatica (`setWebSocketAutoResponse`) senza svegliare il DO.
 *
 * Il token del browser arriva come secondo sottoprotocollo
 * (`new WebSocket(url, [REALTIME_PROTOCOL, jwt])`): l'API WebSocket del
 * browser non permette l'header Authorization, e la query string finirebbe
 * nei log. Il Worker lo verifica e controlla l'accesso al progetto PRIMA di
 * inoltrare la richiesta al DO, che quindi non vede mai richieste anonime.
 */

const ROUTE = /^\/realtime\/projects\/([^/]+)$/;
const PUBLISH_URL = "https://realtime.internal/publish";

export interface RealtimeEnv {
  JWT_SECRET: string;
  PROJECT_REALTIME?: DurableObjectNamespace;
}

/** Estrae il projectId se il path e' quello della board in tempo reale. */
export function matchRealtimePath(pathname: string): string | null {
  const m = ROUTE.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * GET /realtime/projects/:projectId (Upgrade: websocket). Risposte:
 * 426 senza upgrade, 401 token assente/non valido, 403 progetto non
 * accessibile, 404 progetto inesistente, 503 binding DO non configurato.
 */
export async function handleRealtimeUpgrade(request: Request, env: RealtimeEnv, projectId: string): Promise<Response> {
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return plain(426, "Upgrade a WebSocket richiesto");
  }
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (protocols[0] !== REALTIME_PROTOCOL || !protocols[1]) return plain(401, "Token mancante");

  const payload = await verifyAccessToken(env, `Bearer ${protocols[1]}`);
  if (!payload) return plain(401, "Token non valido");
  const user = await getAuthUser(payload.sub);
  if (!user) return plain(401, "Utente non piu' valido");
  try {
    await assertProjectAccess(user, projectId);
  } catch {
    return plain(403, "Non hai accesso a questo progetto");
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return plain(404, "Progetto non trovato");

  if (!env.PROJECT_REALTIME) return plain(503, "Tempo reale non configurato");
  // Il token non serve al DO: gli arriva solo il sottoprotocollo da confermare.
  const headers = new Headers(request.headers);
  headers.set("Sec-WebSocket-Protocol", REALTIME_PROTOCOL);
  const stub = env.PROJECT_REALTIME.get(env.PROJECT_REALTIME.idFromName(projectId));
  return stub.fetch(new Request(request.url, { method: "GET", headers }) as never) as unknown as Response;
}

/** Inoltra l'avviso al DO del progetto. La promise va passata a `ctx.waitUntil`. */
export async function sendToProjectRealtime(
  namespace: DurableObjectNamespace,
  message: BoardChangeMessage,
): Promise<void> {
  const stub = namespace.get(namespace.idFromName(message.projectId));
  const res = await stub.fetch(PUBLISH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Durable Object realtime: HTTP ${res.status}`);
}

/**
 * Durable Object della board di un progetto. Non salva nulla nello storage:
 * lo stato sono solo i WebSocket accettati (che sopravvivono all'ibernazione).
 */
export class ProjectRealtime {
  constructor(private readonly ctx: DurableObjectState, _env: unknown) {
    // Keepalive del client gestito dal runtime, senza svegliare il DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/publish") {
      const body = await request.text();
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(body);
        } catch {
          // Socket gia' in chiusura: verra' rimosso da webSocketClose.
        }
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return plain(426, "Upgrade a WebSocket richiesto");
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server as unknown as CfWebSocket);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": REALTIME_PROTOCOL },
    } as ResponseInit);
  }

  // Il client non manda altro che "ping" (gestito dall'auto-response).
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: CfWebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Gia' chiuso.
    }
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    try {
      ws.close(1011, "errore");
    } catch {
      // Gia' chiuso.
    }
  }
}
