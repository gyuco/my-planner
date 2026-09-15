import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright per apps/web (T4-T9, vedi BACKLOG.md).
 *
 * Bootstrap completo: `webServer` avvia sia il backend (REST + MCP HTTP,
 * via apps/server/scripts/e2e-server.mjs, che gestisce anche
 * migrazione/reset di un DB SQLite e2e dedicato, mai dev.db/test.db) sia il
 * frontend (`vite`), cosi' che `npm run --workspace apps/web test:e2e`
 * funzioni da solo senza richiedere altri processi già in esecuzione.
 *
 * Porte dedicate ai test e2e (diverse da quelle di sviluppo, 3000/5173, per
 * evitare conflitti con un server di sviluppo eventualmente già attivo):
 * - backend "local"  (T4,T5,T6-local,T7,T8,T9): REST 3050, MCP HTTP 3150
 * - backend "s3"     (T6-s3, usa il MinIO di docker-compose):
 *   REST 3051, MCP HTTP 3151
 * - frontend "local" (proxy verso il backend "local"): 5183
 * - frontend "s3"    (proxy verso il backend "s3"): 5184
 *
 * Lo scenario T6 "s3" richiede il servizio MinIO di `docker-compose.yml`
 * (root del repo) attivo su localhost:9000 con le credenziali di default
 * (minioadmin/minioadmin) e il bucket `my-planner-attachments` già creato
 * (`docker compose up -d minio minio-init`). Se MinIO non è raggiungibile,
 * il backend "s3" fallirà ad avviarsi e lo scenario T6/s3 fallirà: è una
 * scelta esplicita (vedi BACKLOG.md T6/I1), non c'è fallback/mocking.
 */
const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..", "..");

const E2E_JWT_SECRET = "e2e-test-secret-do-not-use-in-prod";
const E2E_BOOTSTRAP_USERNAME = "e2e-bootstrap";
const E2E_BOOTSTRAP_PASSWORD = "e2e-bootstrap-password";

export { E2E_JWT_SECRET, E2E_BOOTSTRAP_USERNAME, E2E_BOOTSTRAP_PASSWORD };

const BASE_URL = "http://localhost:5183";
const S3_BASE_URL = "http://localhost:5184";

export { BASE_URL, S3_BASE_URL };

function backendEnv(overrides: Record<string, string>) {
  return {
    ...process.env,
    JWT_SECRET: E2E_JWT_SECRET,
    BOOTSTRAP_USERNAME: E2E_BOOTSTRAP_USERNAME,
    BOOTSTRAP_PASSWORD: E2E_BOOTSTRAP_PASSWORD,
    ...overrides,
  };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 667 } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npm run e2e:server --workspace apps/server",
      cwd: repoRoot,
      url: "http://localhost:3050/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: backendEnv({
        DATABASE_URL: "file:./e2e.db",
        PORT: "3050",
        MCP_HTTP_PORT: "3150",
        MCP_HTTP_BASE_URL: "http://localhost:3150",
        ATTACHMENTS_BACKEND: "local",
        ATTACHMENTS_LOCAL_DIR: "./test-tmp/attachments-e2e-local",
      }),
    },
    {
      command: "npx vite",
      cwd: webRoot,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, VITE_DEV_PORT: "5183", VITE_API_PROXY_TARGET: "http://localhost:3050" },
    },
    // Backend/frontend dedicati allo scenario T6 "s3": avviati solo se
    // E2E_S3=1 (richiede il MinIO di docker-compose.yml già attivo, vedi
    // BACKLOG.md T6/I1 - "docker compose up -d minio minio-init"). Di
    // default disattivati per non far fallire l'intera suite quando Docker
    // non è disponibile; lo scenario s3 stesso si auto-skippa in quel caso
    // (vedi e2e/t6-attachments.spec.ts).
    ...(process.env.E2E_S3 === "1"
      ? [
          {
            command: "npm run e2e:server --workspace apps/server",
            cwd: repoRoot,
            url: "http://localhost:3051/health",
            reuseExistingServer: false,
            timeout: 60_000,
            env: backendEnv({
              DATABASE_URL: "file:./e2e-s3.db",
              PORT: "3051",
              MCP_HTTP_PORT: "3151",
              MCP_HTTP_BASE_URL: "http://localhost:3151",
              ATTACHMENTS_BACKEND: "s3",
              S3_ENDPOINT: "http://localhost:9000",
              S3_BUCKET: "my-planner-attachments",
              S3_ACCESS_KEY_ID: "minioadmin",
              S3_SECRET_ACCESS_KEY: "minioadmin",
              S3_REGION: "us-east-1",
            }),
          },
          {
            command: "npx vite",
            cwd: webRoot,
            url: S3_BASE_URL,
            reuseExistingServer: false,
            timeout: 60_000,
            env: { ...process.env, VITE_DEV_PORT: "5184", VITE_API_PROXY_TARGET: "http://localhost:3051" },
          },
        ]
      : []),
  ],
  outputDir: path.join(repoRoot, "test-results", "playwright"),
});
