import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Global setup Vitest (eseguito una volta, in un processo separato prima di
 * tutti i test): prepara un DB SQLite dedicato ai test
 * (apps/server/prisma/test.db), separato dal dev.db reale, applicando le
 * migrazioni Prisma esistenti. Ripulito a fine suite.
 */
const serverRoot = path.resolve(__dirname, "..");
const testDbPath = path.join(serverRoot, "prisma", "test.db");
const testDbUrl = "file:./prisma/test.db";

export default async function globalSetup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }

  execSync("npx prisma migrate deploy", {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: "inherit",
  });

  return async () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      const p = testDbPath + suffix;
      if (existsSync(p)) rmSync(p);
    }
  };
}
