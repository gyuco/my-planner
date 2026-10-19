import type { SmtpSocketFactory } from "./smtp.js";

/**
 * Punti di iniezione runtime per l'invio email, sul modello di
 * attachmentStorage/provider.ts:
 *  - socket factory: Node (lib/email/socket.node.ts) o Worker
 *    (src/cf/smtpSocket.ts). Nessuna factory registrata = invio disattivato;
 *  - background runner: le email partono dopo la risposta. Su Node basta non
 *    attendere la promise; sul Worker serve `ctx.waitUntil`, altrimenti
 *    l'invio viene interrotto alla fine della richiesta.
 */

let socketFactory: SmtpSocketFactory | null = null;

export function setSmtpSocketFactory(factory: SmtpSocketFactory | null) {
  socketFactory = factory;
}

export function getSmtpSocketFactory(): SmtpSocketFactory | null {
  return socketFactory;
}

type BackgroundRunner = (task: Promise<unknown>) => void;

let runner: BackgroundRunner = (task) => {
  void task;
};

export function setBackgroundRunner(r: BackgroundRunner) {
  runner = r;
}

/** Esegue `task` senza bloccare il chiamante; gli errori vengono solo loggati. */
export function runInBackground(label: string, task: () => Promise<unknown>) {
  runner(
    Promise.resolve()
      .then(task)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[my-planner] ${label}`, err);
      }),
  );
}
