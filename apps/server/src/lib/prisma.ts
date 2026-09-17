import type { PrismaClient } from "@prisma/client";

/**
 * Client Prisma condiviso tra il runtime Node (Fastify, test, CLI) e il
 * runtime Cloudflare Workers (D1 via @prisma/adapter-d1).
 *
 * IMPORTANTE: questo modulo NON importa a runtime `@prisma/client` (solo
 * il tipo, eraso dal typechecker) cosi' che il bundle del Worker non
 * trascini il client Node con engine binario. Il client attivo viene
 * iniettato da chi inizializza il runtime:
 *  - Node:   lib/prisma.node.ts (nuovo PrismaClient SQLite) via setPrismaClient()
 *  - Worker: src/cf/db.ts (nuovo PrismaClient D1 con adapter) via setPrismaClient()
 */
let current: PrismaClient | null = null;
let factory: (() => PrismaClient) | null = null;

export function setPrismaClient(client: PrismaClient | null) {
  current = client;
}

/** Factory di default (Node): usata quando nessun client e' stato iniettato. */
export function setDefaultPrismaFactory(f: (() => PrismaClient) | null) {
  factory = f;
}

export function getPrisma(): PrismaClient {
  if (!current) {
    if (!factory) throw new Error("Prisma client non inizializzato: chiamare setPrismaClient()");
    current = factory();
  }
  return current;
}

// Proxy: consente ai service layer di continuare a fare `prisma.task.findMany`
// ecc. indipendentemente dal runtime. I metodi vengono bindati al client
// reale per preservare il `this` (es. `$transaction`).
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = (client as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
  set(_target, prop, value) {
    (getPrisma() as unknown as Record<PropertyKey, unknown>)[prop] = value;
    return true;
  },
});