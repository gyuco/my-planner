import { PrismaClient } from "../../prisma/d1client/wasm.js";
import { PrismaD1 } from "@prisma/adapter-d1";
import { setPrismaClient } from "../lib/prisma.js";
import type { CfEnv } from "./env.js";

/**
 * Factory del client Prisma sul runtime Workers (CF2): usa il client D1
 * generato (driverAdapters + engineType client/WASM) con l'adapter D1 sul
 * binding `env.DB`. Il client è condiviso via `setPrismaClient` come su Node,
 * cosi' i service layer restano identici (stessa business logic).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * Il query compiler WASM di Prisma non è rientrante: eseguire due query in
 * parallelo sullo stesso client (come fa il service layer con Promise.all o
 * richieste HTTP concorrenti) manda in hang il Worker ("code had hung").
 * Serializziamo quindi tutte le chiamate al client in un unico chain. Per
 * un'app single-user il costo è trascurabile; `$transaction([...])` viene
 * mappato su un Promise.all delle query già accodate.
 */
function serializeClient<T extends object>(client: T): T {
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (fn: () => Promise<unknown>) => {
    const result = chain.then(fn, fn);
    // La coda non deve mai rigettare, altrimenti le query successive salterebbero.
    chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  function wrap(target: object, receiver: object): object {
    return new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop) as unknown;
        if (typeof value === "function") {
          if (prop === "$transaction") {
            return (arg: unknown) =>
              Array.isArray(arg)
                ? enqueue(() => Promise.all(arg))
                : enqueue(() => Promise.resolve((value as AnyFn).call(receiver, arg)));
          }
          return (...args: unknown[]) => enqueue(() => Promise.resolve((value as AnyFn).apply(receiver, args)));
        }
        if (value !== null && typeof value === "object") {
          return wrap(value as object, value as object);
        }
        return value;
      },
    });
  }

  return wrap(client, client) as T;
}

let cached: ReturnType<typeof serializeClient<PrismaClient>> | null = null;

export function initD1Prisma(env: Pick<CfEnv, "DB">): PrismaClient {
  if (!cached) {
    const adapter = new PrismaD1(env.DB);
    const client = new PrismaClient({ adapter });
    cached = serializeClient(client);
    setPrismaClient(cached as unknown as Parameters<typeof setPrismaClient>[0]);
  }
  return cached as unknown as PrismaClient;
}