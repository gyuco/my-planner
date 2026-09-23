import { PrismaClient } from "@prisma/client";
import { setDefaultPrismaFactory, setPrismaClient } from "./prisma.js";

/**
 * Inizializza il client Prisma per il runtime Node (SQLite classico).
 * Chiamato da index.ts e dai test prima di usare i service layer.
 */
export function initNodePrisma(): PrismaClient {
  const client = new PrismaClient();
  setPrismaClient(client);
  setDefaultPrismaFactory(() => new PrismaClient());
  return client;
}