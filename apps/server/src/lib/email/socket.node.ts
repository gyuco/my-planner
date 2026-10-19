import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import type { SmtpSocket, SmtpSocketFactory } from "./smtp.js";

/**
 * Trasporto SMTP per il runtime Node (Fastify, MCP, test): TLS implicita con
 * node:tls, STARTTLS con upgrade di un socket node:net. Solo Node: il Worker
 * usa src/cf/smtpSocket.ts.
 */

const SOCKET_TIMEOUT_MS = 30_000;

class NodeSmtpSocket implements SmtpSocket {
  private chunks: Uint8Array[] = [];
  private waiter: ((chunk: Uint8Array | null) => void) | null = null;
  private failWaiter: ((err: Error) => void) | null = null;
  private ended = false;
  private error: Error | null = null;

  private readonly onData = (chunk: Buffer) => {
    if (this.waiter) {
      const resolve = this.waiter;
      this.clearWaiters();
      resolve(chunk);
    } else {
      this.chunks.push(chunk);
    }
  };

  private readonly onEnd = () => {
    this.ended = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.clearWaiters();
      resolve(null);
    }
  };

  private readonly onError = (err: Error) => {
    this.error = err;
    if (this.failWaiter) {
      const reject = this.failWaiter;
      this.clearWaiters();
      reject(err);
    }
  };

  constructor(
    private readonly socket: net.Socket,
    private readonly host: string,
  ) {
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy(new Error("Timeout socket SMTP")));
    socket.on("data", this.onData);
    socket.on("end", this.onEnd);
    socket.on("close", this.onEnd);
    socket.on("error", this.onError);
  }

  private clearWaiters() {
    this.waiter = null;
    this.failWaiter = null;
  }

  private detach() {
    this.socket.off("data", this.onData);
    this.socket.off("end", this.onEnd);
    this.socket.off("close", this.onEnd);
    this.socket.off("error", this.onError);
    this.socket.setTimeout(0);
  }

  read(): Promise<Uint8Array | null> {
    if (this.error) return Promise.reject(this.error);
    const next = this.chunks.shift();
    if (next) return Promise.resolve(next);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      this.waiter = resolve;
      this.failWaiter = reject;
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  async startTls(): Promise<SmtpSocket> {
    this.detach();
    const secure = tls.connect({ socket: this.socket, servername: this.host });
    await once(secure, "secureConnect", { signal: AbortSignal.timeout(SOCKET_TIMEOUT_MS) });
    return new NodeSmtpSocket(secure, this.host);
  }

  async close(): Promise<void> {
    this.socket.destroy();
  }
}

export const nodeSmtpSocketFactory: SmtpSocketFactory = async ({ host, port, security }) => {
  const socket =
    security === "tls" ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  try {
    await once(socket, security === "tls" ? "secureConnect" : "connect", {
      signal: AbortSignal.timeout(SOCKET_TIMEOUT_MS),
    });
  } catch (err) {
    socket.destroy();
    throw err;
  }
  return new NodeSmtpSocket(socket, host);
};
