import { afterAll, afterEach } from "vitest";
import { rmSync } from "node:fs";
import path from "node:path";
import { initNodePrisma } from "../src/lib/prisma.node.js";
import { prisma } from "../src/lib/prisma.js";
import { setAttachmentStorageFactory } from "../src/lib/attachmentStorage/provider.js";
import { createLocalAttachmentStorage } from "../src/lib/attachmentStorage/local.js";

initNodePrisma();

// Nei test lo storage allegati e' sempre locale: registra direttamente la
// factory sul provider condiviso senza importare index.ts (che caricherebbe
// anche s3.ts/@aws-sdk, interferendo con i mock di s3.test.ts).
setAttachmentStorageFactory(async () =>
  createLocalAttachmentStorage({
    baseDir: process.env.ATTACHMENTS_LOCAL_DIR ?? "./test-tmp/attachments-local",
  })
);

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
