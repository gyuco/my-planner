import { afterAll, afterEach } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";

/**
 * Pulisce tutte le tabelle applicative dopo ogni test (ordine che rispetta
 * le FK: dipendenze/commenti/allegati prima dei task, poi progetti/token).
 * Lascia lo schema intatto (creato una volta da globalSetup via migrate deploy).
 */
export async function cleanDatabase() {
  await prisma.taskDependency.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectToken.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

afterEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  const attachmentsDir = path.resolve(__dirname, "..", process.env.ATTACHMENTS_LOCAL_DIR ?? "./test-tmp/attachments-local");
  try {
    rmSync(attachmentsDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});
