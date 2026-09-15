import { defineConfig } from "vitest/config";

/**
 * Config Vitest per apps/server (T1-T3, vedi BACKLOG.md).
 * I test che toccano il DB usano un SQLite dedicato (prisma/test.db,
 * vedi test/globalSetup.ts) mai il dev.db reale. fileParallelism disattivato
 * per evitare corse concorrenti sullo stesso file SQLite tra file di test.
 */
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    env: {
      DATABASE_URL: "file:./prisma/test.db",
      JWT_SECRET: "test-secret-do-not-use-in-prod",
      ATTACHMENTS_BACKEND: "local",
      ATTACHMENTS_LOCAL_DIR: "./test-tmp/attachments-local",
      MCP_HTTP_PORT: "3100",
    },
    include: ["src/**/*.test.ts"],
  },
});
