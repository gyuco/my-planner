/**
 * Client SMTP minimale condiviso tra Node e Workers. Implementa solo il
 * sottoinsieme necessario a un invio semplice: EHLO, STARTTLS, AUTH LOGIN,
 * MAIL/RCPT/DATA. Il trasporto (TCP/TLS) e' astratto da `SmtpSocket`:
 *  - Node:   lib/email/socket.node.ts (node:net / node:tls)
 *  - Worker: src/cf/smtpSocket.ts (cloudflare:sockets)
 * cosi' questo modulo non importa nulla di specifico del runtime.
 */

export type SmtpSecurity = "tls" | "starttls" | "none";

export interface SmtpSocket {
  /** Prossimo chunk ricevuto, `null` a connessione chiusa. */
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  /** Upgrade STARTTLS: restituisce il socket cifrato, il precedente non va piu' usato. */
  startTls(): Promise<SmtpSocket>;
  close(): Promise<void>;
}

export type SmtpSocketFactory = (opts: { host: string; port: number; security: SmtpSecurity }) => Promise<SmtpSocket>;

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  /** Vuoto/null = nessuna autenticazione (es. relay locale). */
  username?: string | null;
  password?: string | null;
  fromAddress: string;
  fromName?: string | null;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

const CRLF = "\r\n";
const DEFAULT_TIMEOUT_MS = 30_000;

interface SmtpResponse {
  code: number;
  text: string;
}

class SmtpConnection {
  private buffer = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(public socket: SmtpSocket) {}

  private async readLine(): Promise<string> {
    while (!this.buffer.includes("\n")) {
      const chunk = await this.socket.read();
      if (!chunk) throw new Error("Connessione SMTP chiusa inaspettatamente");
      this.buffer += this.decoder.decode(chunk, { stream: true });
    }
    const idx = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, idx).replace(/\r?$/, "");
    this.buffer = this.buffer.slice(idx + 1);
    return line;
  }

  // Risposta SMTP multi-riga: "250-x\r\n250 y\r\n" -> continua finché il
  // separatore dopo il codice è uno spazio (non un trattino).
  async readResponse(): Promise<SmtpResponse> {
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

  async send(command: string): Promise<SmtpResponse> {
    await this.socket.write(this.encoder.encode(command + CRLF));
    return this.readResponse();
  }

  /** Dopo STARTTLS il buffer in chiaro va scartato (RFC 3207 §4.2). */
  async upgrade(): Promise<void> {
    this.socket = await this.socket.startTls();
    this.buffer = "";
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

// CR/LF in un header (titolo task, nome mittente...) permetterebbe di
// iniettare header arbitrari (Bcc ecc.): vanno sempre appiattiti.
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// Header RFC 2047 (encoded-word): accenti/trattini lunghi in un header raw
// arriverebbero come mojibake. Anche i caratteri speciali di un display-name
// (virgole, virgolette...) vengono codificati, cosi' non serve il quoting.
function encodeHeader(value: string): string {
  const flat = singleLine(value);
  return /^[A-Za-z0-9 ._\-[\]/#:!?+'()]*$/.test(flat) ? flat : `=?UTF-8?B?${toBase64(flat)}?=`;
}

// Le righe base64 vanno spezzate: SMTP ammette al massimo 998 caratteri per
// riga, e il limite convenzionale MIME e' 76.
function base64Lines(input: string): string[] {
  const encoded = toBase64(input);
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76));
  return lines;
}

/**
 * Validazione volutamente conservativa: l'indirizzo finisce in `MAIL FROM` /
 * `RCPT TO`, quindi niente spazi, CR/LF o `<>` che altererebbero il comando.
 */
export function isSafeEmailAddress(address: string): boolean {
  return /^[^\s<>()[\]\\,;:"@]+@[^\s<>()[\]\\,;:"@]+\.[^\s<>()[\]\\,;:"@]+$/.test(address);
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

export function buildMimeMessage(config: SmtpConfig, message: MailMessage): string {
  const from = config.fromName?.trim()
    ? `${encodeHeader(config.fromName)} <${config.fromAddress}>`
    : config.fromAddress;
  // Piu' destinatari nella stessa transazione: nessuno deve vedere gli
  // indirizzi degli altri (equivalente a un Bcc).
  const to = message.to.length === 1 ? message.to[0] : "undisclosed-recipients:;";
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domainOf(config.fromAddress)}>`,
    "MIME-Version: 1.0",
  ];

  // Corpo in base64: niente dot-stuffing da gestire (nessuna riga puo'
  // iniziare con ".") e nessun problema con gli accenti su 8 bit.
  let lines: string[];
  if (message.html) {
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
      ...base64Lines(message.text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      ...base64Lines(message.html),
      `--${boundary}--`,
    ];
  } else {
    lines = [
      ...headers,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      ...base64Lines(message.text),
    ];
  }
  return [...lines, "."].join(CRLF);
}

async function deliver(
  connect: SmtpSocketFactory,
  config: SmtpConfig,
  message: MailMessage,
  session: { conn?: SmtpConnection },
): Promise<void> {
  if (!isSafeEmailAddress(config.fromAddress)) throw new Error(`Indirizzo mittente non valido: ${config.fromAddress}`);
  const recipients = message.to.filter(isSafeEmailAddress);
  if (recipients.length === 0) throw new Error("Nessun destinatario valido");
  if (config.username && config.security === "none") {
    // Mai credenziali in chiaro sulla rete.
    throw new Error("Autenticazione SMTP non consentita senza TLS/STARTTLS");
  }

  const conn = new SmtpConnection(await connect({ host: config.host, port: config.port, security: config.security }));
  session.conn = conn;
  const ehlo = `EHLO ${domainOf(config.fromAddress)}`;
  try {
    expect(await conn.readResponse(), 2, "greeting");
    expect(await conn.send(ehlo), 2, "EHLO");

    if (config.security === "starttls") {
      expect(await conn.send("STARTTLS"), 2, "STARTTLS");
      await conn.upgrade();
      expect(await conn.send(ehlo), 2, "EHLO (dopo STARTTLS)");
    }

    if (config.username) {
      expect(await conn.send("AUTH LOGIN"), 3, "AUTH LOGIN");
      expect(await conn.send(toBase64(config.username)), 3, "AUTH username");
      expect(await conn.send(toBase64(config.password ?? "")), 2, "AUTH password (con Gmail serve una App Password)");
    }

    expect(await conn.send(`MAIL FROM:<${config.fromAddress}>`), 2, "MAIL FROM");
    // Un destinatario rifiutato non deve bloccare gli altri.
    let accepted = 0;
    for (const rcpt of recipients) {
      const res = await conn.send(`RCPT TO:<${rcpt}>`);
      if (Math.floor(res.code / 100) === 2) accepted++;
    }
    if (accepted === 0) throw new Error("SMTP RCPT TO fallito: nessun destinatario accettato");

    expect(await conn.send("DATA"), 3, "DATA");
    expect(await conn.send(buildMimeMessage(config, { ...message, to: recipients })), 2, "invio corpo email");
    await conn.send("QUIT").catch(() => undefined);
  } finally {
    await conn.socket.close().catch(() => undefined);
  }
}

/**
 * Invia una email. Il timeout copre l'intera sessione: un server che non
 * risponde non deve tenere appeso il chiamante (né un Worker in waitUntil).
 */
export async function sendMail(
  connect: SmtpSocketFactory,
  config: SmtpConfig,
  message: MailMessage,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const session: { conn?: SmtpConnection } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Chiude il socket: sblocca la read pendente e libera la connessione.
      void session.conn?.socket.close().catch(() => undefined);
      reject(new Error(`Timeout SMTP dopo ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([deliver(connect, config, message, session), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
