// Solo per i test: server SMTP finto, nessuna rete.
import type { SmtpSocket, SmtpSocketFactory } from "./smtp.js";

/**
 * Server SMTP finto in memoria: risponde ai comandi del client e registra
 * comandi, corpo DATA e upgrade STARTTLS, senza rete.
 */
export interface FakeSmtpOptions {
  rejectAuth?: boolean;
  rejectRcpt?: string[];
  /** Simula un server irraggiungibile. */
  failConnect?: boolean;
}

export interface FakeSmtpSession {
  commands: string[];
  messages: { from: string; to: string[]; data: string }[];
  startTlsCount: number;
  closed: boolean;
}

export function createFakeSmtp(options: FakeSmtpOptions = {}) {
  const sessions: FakeSmtpSession[] = [];
  const connections: { host: string; port: number; security: string }[] = [];
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const factory: SmtpSocketFactory = async (opts) => {
    connections.push(opts);
    if (options.failConnect) throw new Error("ECONNREFUSED (fake)");

    const session: FakeSmtpSession = { commands: [], messages: [], startTlsCount: 0, closed: false };
    sessions.push(session);
    const queue: string[] = ["220 fake.smtp ESMTP\r\n"];
    let authStep = 0;
    let dataMode = false;
    let from = "";
    let to: string[] = [];

    const socket: SmtpSocket = {
      async read() {
        const next = queue.shift();
        return next === undefined ? null : enc.encode(next);
      },
      async write(data) {
        const text = dec.decode(data);
        if (dataMode) {
          dataMode = false;
          session.messages.push({ from, to, data: text });
          queue.push("250 2.0.0 queued\r\n");
          return;
        }
        const cmd = text.replace(/\r\n$/, "");
        session.commands.push(cmd);
        if (authStep === 1) {
          authStep = 2;
          queue.push("334 UGFzc3dvcmQ6\r\n");
        } else if (authStep === 2) {
          authStep = 0;
          queue.push(options.rejectAuth ? "535 5.7.8 bad credentials\r\n" : "235 2.7.0 ok\r\n");
        } else if (cmd.startsWith("EHLO")) {
          queue.push("250-fake.smtp\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n");
        } else if (cmd === "STARTTLS") {
          queue.push("220 2.0.0 ready\r\n");
        } else if (cmd === "AUTH LOGIN") {
          authStep = 1;
          queue.push("334 VXNlcm5hbWU6\r\n");
        } else if (cmd.startsWith("MAIL FROM:")) {
          from = cmd.slice("MAIL FROM:<".length, -1);
          to = [];
          queue.push("250 ok\r\n");
        } else if (cmd.startsWith("RCPT TO:")) {
          const rcpt = cmd.slice("RCPT TO:<".length, -1);
          if (options.rejectRcpt?.includes(rcpt)) {
            queue.push("550 5.1.1 no such user\r\n");
          } else {
            to.push(rcpt);
            queue.push("250 ok\r\n");
          }
        } else if (cmd === "DATA") {
          dataMode = true;
          queue.push("354 go ahead\r\n");
        } else if (cmd === "QUIT") {
          queue.push("221 bye\r\n");
        } else {
          queue.push("500 unknown\r\n");
        }
      },
      async startTls() {
        session.startTlsCount++;
        return socket;
      },
      async close() {
        session.closed = true;
      },
    };
    return socket;
  };

  return { factory, sessions, connections };
}

/** Decodifica le parti base64 di un messaggio MIME (per asserzioni sul corpo). */
export function decodeMimeBodies(raw: string): string {
  const re = /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--|\r\n\.$)/g;
  return [...raw.matchAll(re)]
    .map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"))
    .join("\n");
}
