import type { EmailSecurity, EmailSettings } from "@my-planner/core";
import { ApiErrorException } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";
import { isSafeEmailAddress, sendMail, type SmtpConfig } from "../lib/email/smtp.js";
import { getSmtpSocketFactory } from "../lib/email/provider.js";

/**
 * Config SMTP per le email di notifica (singleton, admin-only). La password e'
 * cifrata a riposo (lib/secretBox.ts) e non esce mai dalle API pubbliche.
 */

const SINGLETON_ID = "singleton";

type EmailSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.emailSettings.findUnique>>>;

function isComplete(row: Pick<EmailSettingsRow, "host" | "fromAddress" | "username" | "passwordEnc">): boolean {
  return Boolean(row.host && row.fromAddress && (!row.username || row.passwordEnc));
}

function toPublic(row: EmailSettingsRow | null): EmailSettings {
  if (!row) {
    return {
      enabled: false,
      configured: false,
      host: null,
      port: 465,
      security: "tls",
      username: null,
      passwordSet: false,
      fromAddress: null,
      fromName: "my-planner",
      appUrl: null,
      updatedAt: null,
    };
  }
  return {
    enabled: row.enabled,
    configured: row.enabled && isComplete(row),
    host: row.host,
    port: row.port,
    security: row.security as EmailSecurity,
    username: row.username,
    passwordSet: Boolean(row.passwordEnc),
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    appUrl: row.appUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findRow() {
  return prisma.emailSettings.findUnique({ where: { id: SINGLETON_ID } });
}

/** URL pubblico dell'app (impostazioni notifiche email) o null se non configurato. */
export async function getAppUrl(): Promise<string | null> {
  return (await findRow())?.appUrl ?? null;
}

/** Link diretto a un task, secondo lo schema URL del frontend (API_CONTRACT.md §1b). */
export function buildTaskUrl(appUrl: string, projectId: string, taskId: string): string {
  return `${appUrl}/projects/${encodeURIComponent(projectId)}?task=${encodeURIComponent(taskId)}`;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  return toPublic(await findRow());
}

export interface EmailSettingsInput {
  enabled: boolean;
  host?: string | null;
  port: number;
  security: EmailSecurity;
  username?: string | null;
  password?: string | null;
  fromAddress?: string | null;
  fromName?: string;
  appUrl?: string | null;
}

function validationError(message: string): never {
  throw new ApiErrorException("VALIDATION_ERROR", message);
}

export async function updateEmailSettings(input: EmailSettingsInput): Promise<EmailSettings> {
  const host = input.host?.trim() || null;
  const username = input.username?.trim() || null;
  const fromAddress = input.fromAddress?.trim() || null;
  const appUrl = input.appUrl?.trim().replace(/\/+$/, "") || null;

  if (host && !/^[A-Za-z0-9.-]+$/.test(host)) validationError("host SMTP non valido");
  if (fromAddress && !isSafeEmailAddress(fromAddress)) validationError("fromAddress non è un indirizzo email valido");
  if (appUrl && !/^https?:\/\/[^\s]+$/.test(appUrl)) validationError("appUrl deve iniziare con http:// o https://");
  if (username && input.security === "none") {
    validationError("Le credenziali SMTP richiedono TLS o STARTTLS (mai in chiaro)");
  }

  const existing = await findRow();

  // Password: nuova => cifrata; vuota/omessa => invariata; senza username non
  // serve, quindi viene rimossa insieme a lui.
  let passwordEnc = existing?.passwordEnc ?? null;
  if (!username) passwordEnc = null;
  else if (input.password) passwordEnc = await encryptSecret(input.password);

  if (input.enabled) {
    if (!host) validationError("host è obbligatorio per abilitare le email");
    if (!fromAddress) validationError("fromAddress è obbligatorio per abilitare le email");
    if (username && !passwordEnc) validationError("password è obbligatoria quando è impostato lo username");
  }

  const data = {
    enabled: input.enabled,
    host,
    port: input.port,
    security: input.security,
    username,
    passwordEnc,
    fromAddress,
    fromName: input.fromName?.trim() || "my-planner",
    appUrl,
  };
  const row = await prisma.emailSettings.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });
  return toPublic(row);
}

async function toSmtpConfig(row: EmailSettingsRow): Promise<SmtpConfig> {
  return {
    host: row.host!,
    port: row.port,
    security: row.security as EmailSecurity,
    username: row.username,
    password: row.passwordEnc ? await decryptSecret(row.passwordEnc) : null,
    fromAddress: row.fromAddress!,
    fromName: row.fromName,
  };
}

export interface ActiveEmailConfig {
  smtp: SmtpConfig;
  appUrl: string | null;
}

/**
 * Config pronta per l'invio, oppure `null` se le email non vanno inviate:
 * nessuna riga, disabilitata, incompleta, nessun trasporto registrato o
 * password non decifrabile (chiave cambiata). Non lancia mai: chi la usa
 * (notifiche) non deve fallire per colpa della config email.
 */
export async function getActiveEmailConfig(): Promise<ActiveEmailConfig | null> {
  try {
    if (!getSmtpSocketFactory()) return null;
    const row = await findRow();
    if (!row || !row.enabled || !isComplete(row)) return null;
    return { smtp: await toSmtpConfig(row), appUrl: row.appUrl };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[my-planner] config email non utilizzabile, invio saltato", err);
    return null;
  }
}

/**
 * Email di prova con la config salvata (anche se non ancora abilitata), cosi'
 * l'admin verifica le credenziali prima di attivare le notifiche.
 */
export async function sendTestEmail(to: string): Promise<{ ok: true; to: string }> {
  if (!isSafeEmailAddress(to)) validationError("Destinatario non valido");
  const factory = getSmtpSocketFactory();
  if (!factory) throw new ApiErrorException("EMAIL_SEND_FAILED", "Invio email non supportato da questo runtime");

  const row = await findRow();
  if (!row || !isComplete(row)) validationError("Configurazione SMTP incompleta: salva host, mittente e credenziali");

  let smtp: SmtpConfig;
  try {
    smtp = await toSmtpConfig(row);
  } catch {
    validationError("Password SMTP non decifrabile (chiave di cifratura cambiata?): reinseriscila");
  }

  try {
    await sendMail(factory, smtp, {
      to: [to],
      subject: "my-planner — email di prova",
      text: "Configurazione SMTP funzionante: le notifiche via email possono partire.",
    });
  } catch (err) {
    throw new ApiErrorException("EMAIL_SEND_FAILED", err instanceof Error ? err.message : "Invio fallito");
  }
  return { ok: true, to };
}
