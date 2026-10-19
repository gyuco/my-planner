import type { CfEnv } from "./env.js";
import { sendMail } from "../lib/email/smtp.js";
import { cfSmtpSocketFactory } from "./smtpSocket.js";

/**
 * Standup giornaliero (CF): SMTP Gmail con App Password su
 * smtp.gmail.com:465 (TLS implicita), non con la password dell'account né
 * con OAuth2. Credenziali dai secrets del Worker, indipendenti dalla config
 * SMTP delle notifiche (EmailSettings). Il protocollo vive nel client
 * condiviso lib/email/smtp.ts.
 */
export async function sendStandupEmail(env: CfEnv, subject: string, bodyText: string, bodyHtml?: string): Promise<void> {
  await sendMail(
    cfSmtpSocketFactory,
    {
      host: "smtp.gmail.com",
      port: 465,
      security: "tls",
      username: env.GMAIL_USER,
      password: env.GMAIL_APP_PASSWORD,
      fromAddress: env.GMAIL_USER,
      fromName: "my-planner",
    },
    { to: [env.STANDUP_RECIPIENT], subject, text: bodyText, html: bodyHtml },
  );
}
