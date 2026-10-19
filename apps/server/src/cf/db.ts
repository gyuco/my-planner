import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "../../prisma/d1client/wasm.js";
import { PrismaD1 } from "@prisma/adapter-d1";
import { setPrismaResolver } from "../lib/prisma.js";
import type { CfEnv } from "./env.js";

/**
 * Factory del client Prisma sul runtime Workers (CF2): usa il client D1
 * generato (driverAdapters + engineType client/WASM) con l'adapter D1 sul
 * binding `env.DB`. Il client viene esposto ai service layer tramite il
 * resolver di lib/prisma.ts, cosi' la business logic resta identica a Node.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * Il query compiler WASM di Prisma non è rientrante: eseguire due query in
 * parallelo sullo stesso client (come fa il service layer con Promise.all)
 * manda in hang il Worker ("code had hung"). Serializziamo quindi tutte le
 * chiamate al client in un unico chain. `$transaction([...])` viene mappato
 * su un Promise.all delle query già accodate.
 *
 * ATTENZIONE: il chain non deve mai essere condiviso tra richieste diverse —
 * vedi il commento su setPrismaResolver in lib/prisma.ts. Per questo vive
 * nella closure di un client creato per singola richiesta, non in un modulo.
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

/**
 * Scope della richiesta in corso. `prisma` (lib/prisma.ts) legge da qui, quindi
 * ogni richiesta lavora sul proprio client e sulla propria coda: nessuna
 * promise viene mai attraversata tra I/O context diversi.
 */
const requestScope = new AsyncLocalStorage<PrismaClient>();

setPrismaResolver(() => requestScope.getStore() ?? null);

function createRequestPrisma(env: Pick<CfEnv, "DB">): PrismaClient {
  const adapter = new PrismaD1(env.DB);
  return serializeClient(new PrismaClient({ adapter })) as unknown as PrismaClient;
}

/**
 * Esegue `fn` con un client Prisma/D1 dedicato alla richiesta corrente.
 * Va usato per ogni invocazione del Worker (fetch e scheduled).
 */
export function withRequestPrisma<T>(env: Pick<CfEnv, "DB">, fn: () => Promise<T>): Promise<T> {
  return requestScope.run(createRequestPrisma(env), fn);
}
