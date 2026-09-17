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
  BOOTSTRAP_USERNAME?: string;
  BOOTSTRAP_PASSWORD?: string;
  MCP_HTTP_BASE_URL?: string;
  // Var statiche optionale (vedi wrangler.toml [vars])
  PORT?: string;
}