import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

/**
 * Binding del Worker Cloudflare (CF1). Passato come `env` a fetch e ai Durable
 * Objects. `DB` = D1, `ATTACHMENTS` = R2; i valori sensibili (JWT_SECRET,
 * BOOTSTRAP_*) arrivano come vars/secrets definiti in wrangler.toml.
 */
export interface CfEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  JWT_SECRET: string;
  BOOTSTRAP_EMAIL?: string;
  BOOTSTRAP_PASSWORD?: string;
  MCP_HTTP_BASE_URL?: string;
  // Var statiche optionale (vedi wrangler.toml [vars])
  PORT?: string;

  // Standup giornaliero via Cron Trigger (vedi wrangler.toml [triggers] e
  // src/cf/standup.ts). Invio via SMTP Gmail (smtp.gmail.com:465) con App
  // Password (Account Google → Sicurezza → Password per le app) — non la
  // password dell'account.
  GMAIL_USER: string;
  GMAIL_APP_PASSWORD: string;
  STANDUP_RECIPIENT: string;
}