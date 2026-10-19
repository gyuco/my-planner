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
let resolver: (() => PrismaClient | null) | null = null;

export function setPrismaClient(client: PrismaClient | null) {
  current = client;
}

/**
 * Resolver per-richiesta, usato dal runtime Workers (src/cf/db.ts).
 *
 * Su workerd ogni continuation di promise resta legata all'I/O context della
 * richiesta che l'ha creata: un client (e la sua coda di serializzazione)
 * condiviso tra richieste fa si' che una richiesta si accodi dietro una
 * promise di un'altra richiesta gia' terminata, che non si risolvera' mai —
 * il Worker va in hang ("code had hung and would never generate a response")
 * e l'isolate resta avvelenato. Il Worker registra quindi un resolver che
 * restituisce il client della richiesta in corso; su Node resta null e si usa
 * il client iniettato con setPrismaClient().
 */
export function setPrismaResolver(r: (() => PrismaClient | null) | null) {
  resolver = r;
}

/** Factory di default (Node): usata quando nessun client e' stato iniettato. */
export function setDefaultPrismaFactory(f: (() => PrismaClient) | null) {
  factory = f;
}

export function getPrisma(): PrismaClient {
  const scoped = resolver?.();
  if (scoped) return scoped;
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