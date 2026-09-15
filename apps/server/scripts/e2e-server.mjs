#!/usr/bin/env node
/**
 * Bootstrap del backend per i test e2e Playwright (apps/web, BACKLOG.md T4-T9).
 *
 * Usa un DB SQLite dedicato (DATABASE_URL passata dall'ambiente, es.
 * "file:./prisma/e2e.db" o "file:./prisma/e2e-s3.db"), MAI dev.db (usato in
 * sviluppo) né test.db (usato da Vitest, vedi vitest.config.ts). Il DB viene
 * azzerato e ri-migrato ad ogni avvio di questo script, cosi' ogni run della
 * suite e2e parte da uno stato pulito con solo l'utente bootstrap (env
 * BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD).
 *
 * Avvia in parallelo il transport REST/HTTP (src/index.ts) e il transport
 * MCP HTTP (src/mcp/http.ts, usato da T7/T8), sulla porta indicata da PORT e
 * MCP_HTTP_PORT. Tutte le env necessarie (JWT_SECRET, BOOTSTRAP_*, DATABASE_URL,
 * ATTACHMENTS_BACKEND, ...) vanno passate dal processo chiamante (vedi
 * apps/web/playwright.config.ts) - questo script non tocca mai apps/server/.env.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.startsWith("file:")) {
  console.error(
    "[e2e-server] DATABASE_URL mancante o non SQLite. Imposta una DATABASE_URL " +
      "file: dedicata ai test e2e (mai dev.db/test.db) prima di lanciare questo script.",
  );
  process.exit(1);
}

const dbRelativePath = databaseUrl.replace(/^file:/, "");
// Nota: Prisma risolve gli URL "file:" sempre relativi alla cartella dello
// schema.prisma (apps/server/prisma/), MAI relativi alla cwd del processo
// (stesso comportamento di apps/server/test/globalSetup.ts per Vitest,
// vedi vitest.config.ts DATABASE_URL="file:./prisma/test.db" ->
// apps/server/prisma/prisma/test.db). Replichiamo qui la stessa risoluzione
// per poter cancellare/ricreare il file giusto.
const dbAbsolutePath = path.resolve(serverRoot, "prisma", dbRelativePath);

// Safety net: rifiuta esplicitamente dev.db/test.db, non solo per errore
// umano ma perche' questo script CANCELLA il DB ad ogni avvio.
const forbidden = ["dev.db", "test.db"];
if (forbidden.some((name) => dbAbsolutePath.endsWith(name))) {
  console.error(`[e2e-server] Rifiuto di usare ${dbAbsolutePath}: riservato a dev/Vitest.`);
  process.exit(1);
}

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const p = dbAbsolutePath + suffix;
  if (existsSync(p)) rmSync(p);
}
mkdirSync(path.dirname(dbAbsolutePath), { recursive: true });

if (process.env.ATTACHMENTS_LOCAL_DIR) {
  const localDir = path.resolve(serverRoot, process.env.ATTACHMENTS_LOCAL_DIR);
  rmSync(localDir, { recursive: true, force: true });
  mkdirSync(localDir, { recursive: true });
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: serverRoot, env: process.env, stdio: "inherit", ...opts });
}

function runSync(cmd, args) {
  const res = run(cmd, args);
  return new Promise((resolve, reject) => {
    res.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
  });
}

async function main() {
  console.log(`[e2e-server] Migrazione DB e2e su ${dbAbsolutePath} ...`);
  await runSync("npx", ["prisma", "migrate", "deploy"]);

  console.log("[e2e-server] Avvio REST (src/index.ts) e MCP HTTP (src/mcp/http.ts) ...");
  const children = [
    run("npx", ["tsx", "src/index.ts"]),
    run("npx", ["tsx", "src/mcp/http.ts"]),
  ];

  let shuttingDown = false;
  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of children) c.kill();
    process.exit(code);
  }

  for (const c of children) {
    c.on("exit", (code) => shutdown(code ?? 1));
  }
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
