import { connect } from "cloudflare:sockets";
import type { SmtpSocket, SmtpSocketFactory } from "../lib/email/smtp.js";

/** Trasporto SMTP del Worker su TCP socket (`cloudflare:sockets`). */

type CfSocket = ReturnType<typeof connect>;

function wrap(socket: CfSocket): SmtpSocket {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const release = () => {
    reader.releaseLock();
    writer.releaseLock();
  };
  return {
    async read() {
      const { value, done } = await reader.read();
      return done ? null : value;
    },
    write: (data) => writer.write(data),
    async startTls() {
      // startTls() richiede che readable/writable non siano lockati.
      release();
      return wrap(socket.startTls());
    },
    async close() {
      try {
        release();
      } catch {
        // gia' rilasciati (es. dopo startTls)
      }
      await socket.close();
    },
  };
}

export const cfSmtpSocketFactory: SmtpSocketFactory = async ({ host, port, security }) => {
  const secureTransport = security === "tls" ? "on" : security === "starttls" ? "starttls" : "off";
  const socket = connect({ hostname: host, port }, { secureTransport, allowHalfOpen: false });
  await socket.opened;
  return wrap(socket);
};
