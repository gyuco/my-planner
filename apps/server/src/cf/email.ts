import { connect } from "cloudflare:sockets";
import type { CfEnv } from "./env.js";

/**
 * Client SMTP minimale su TCP socket (CF: standup giornaliero), non l'API
 * Gmail: autenticazione con App Password su smtp.gmail.com:465 (TLS
 * implicita), non con la password dell'account né con OAuth2. Implementa
 * solo il sottoinsieme di comandi SMTP necessario a un invio semplice.
 */

const CRLF = "\r\n";

interface SmtpResponse {
  code: number;
  text: string;
}

class SmtpConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private socket: ReturnType<typeof connect>) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  private async readLine(): Promise<string> {
    while (!this.buffer.includes("\n")) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("Connessione SMTP chiusa inaspettatamente");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
    const idx = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, idx).replace(/\r?$/, "");
    this.buffer = this.buffer.slice(idx + 1);
    return line;
  }

  // Risposta SMTP multi-riga: "250-x\r\n250 y\r\n" -> continua finché il
  // separatore dopo il codice è uno spazio (non un trattino).
  private async readResponse(): Promise<SmtpResponse> {
    let text = "";
    let code = 0;
    for (;;) {
      const line = await this.readLine();
      text += line + "\n";
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match) throw new Error(`Risposta SMTP inattesa: ${line}`);
      code = Number(match[1]);
      if (match[2] === " ") break;
    }
    return { code, text };
  }

  async greeting(): Promise<SmtpResponse> {
    return this.readResponse();
  }

  async send(command: string): Promise<SmtpResponse> {
    await this.writer.write(this.encoder.encode(command + CRLF));
    return this.readResponse();
  }

  async close(): Promise<void> {
    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.socket.close();
  }
}

function expect(res: SmtpResponse, expectedClass: number, context: string): void {
  if (Math.floor(res.code / 100) !== expectedClass) {
    throw new Error(`SMTP ${context} fallito: ${res.code} ${res.text.trim()}`);
  }
}

function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Header RFC 2047 (encoded-word): l'oggetto contiene accenti/trattini lunghi,
// che in un header raw arriverebbero come mojibake.
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${toBase64(value)}?=`;
}

// Le righe base64 vanno spezzate: SMTP ammette al massimo 998 caratteri per
// riga, e il limite convenzionale MIME e' 76.
function base64Lines(input: string): string[] {
  const encoded = toBase64(input);
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines;
}

export async function sendStandupEmail(env: CfEnv, subject: string, bodyText: string, bodyHtml?: string): Promise<void> {
  const socket = connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
  const conn = new SmtpConnection(socket);
  try {
    expect(await conn.greeting(), 2, "greeting");
    expect(await conn.send("EHLO my-planner.workers.dev"), 2, "EHLO");
    expect(await conn.send("AUTH LOGIN"), 3, "AUTH LOGIN");
    expect(await conn.send(toBase64(env.GMAIL_USER)), 3, "AUTH username");
    expect(await conn.send(toBase64(env.GMAIL_APP_PASSWORD)), 2, "AUTH password (verifica che sia una App Password, non la password dell'account)");
    expect(await conn.send(`MAIL FROM:<${env.GMAIL_USER}>`), 2, "MAIL FROM");
    expect(await conn.send(`RCPT TO:<${env.STANDUP_RECIPIENT}>`), 2, "RCPT TO");
    expect(await conn.send("DATA"), 3, "DATA");

    // Corpo in base64: niente dot-stuffing da gestire (nessuna riga puo'
    // iniziare con ".") e nessun problema con gli accenti su 8 bit.
    const headers = [
      `From: my-planner <${env.GMAIL_USER}>`,
      `To: ${env.STANDUP_RECIPIENT}`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
    ];

    let lines: string[];
    if (bodyHtml) {
      // multipart/alternative: i client che non renderizzano HTML mostrano il
      // testo, che va messo per primo (l'ultima parte e' quella preferita).
      const boundary = `=_my_planner_${crypto.randomUUID().replace(/-/g, "")}`;
      lines = [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        ...base64Lines(bodyText),
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        ...base64Lines(bodyHtml),
        `--${boundary}--`,
      ];
    } else {
      lines = [
        ...headers,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        ...base64Lines(bodyText),
      ];
    }

    const message = [...lines, "."].join(CRLF);

    expect(await conn.send(message), 2, "invio corpo email");
    await conn.send("QUIT");
  } finally {
    await conn.close();
  }
}
