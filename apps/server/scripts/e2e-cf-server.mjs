import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Avvia il Worker Cloudflare per gli scenari e2e (CF17, modalita' E2E_CF=1):
 * reset del DB D1 locale (miniflare), applicazione delle migrazioni e
 * `wrangler dev` sulla porta 3050 (stessa usata dal backend Node negli e2e),
 * cosi' REST + MCP HTTP + allegati R2 girano sullo stesso processo.
 */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Reset dello stato D1 locale per avere un DB e2e pulito ad ogni run.
rmSync(path.join(serverRoot, ".wrangler", "state", "v3", "d1"), { recursive: true, force: true });

const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], {
  cwd: serverRoot,
  stdio: "inherit",
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const child = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    "3050",
    "--local",
    "--var",
    "JWT_SECRET:e2e-test-secret-do-not-use-in-prod",
    "--var",
    "BOOTSTRAP_USERNAME:e2e-bootstrap",
    "--var",
    "BOOTSTRAP_PASSWORD:e2e-bootstrap-password",
    "--var",
    "MCP_HTTP_BASE_URL:http://localhost:3050",
  ],
  { cwd: serverRoot, stdio: "inherit" }
);

child.on("exit", (code) => process.exit(code ?? 0));