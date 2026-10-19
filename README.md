# my-planner

Gestore di progetti e task con board Kanban, utilizzabile da UI web e da server MCP.
Vedi [prd.md](./prd.md) per requisiti e decisioni tecniche complete.

## Stack
Node.js/TypeScript + Fastify, SQLite + Prisma, React + Vite, MCP SDK (stdio + HTTP).

## Struttura

```
apps/server   Fastify REST API + server MCP (stdio e HTTP)
apps/web      React SPA (board Kanban)
packages/core Tipi condivisi tra server e web
```

## Setup locale

Istruzioni complete e troubleshooting: [LOCALE_DEV.md](./LOCALE_DEV.md).

```bash
npm install
# il .env va in apps/server/ (dotenv lo carica dalla cwd del workspace), non nella root:
cp config.example.md apps/server/.env   # poi modifica i valori (vedi config.example.md)
npm run --workspace apps/server prisma:migrate
npm run dev
```

## Migrazioni Prisma: dev vs CI/produzione/docker

Due comandi distinti in `apps/server/package.json`, da non confondere:

- **`npm run --workspace apps/server prisma:migrate`** (→ `prisma migrate dev`): solo in sviluppo locale. Interattivo, crea nuove migrazioni a partire da modifiche a `schema.prisma` e le applica al DB di sviluppo (`apps/server/prisma/dev.db`).
- **`npm run --workspace apps/server prisma:migrate:deploy`** (→ `prisma migrate deploy`): usato in CI (`.github/workflows/ci.yml`, su un DB SQLite effimero) e nel container `server` (`apps/server/docker-entrypoint.sh`, eseguito automaticamente all'avvio prima di lanciare i processi Node). Non interattivo, non genera nuove migrazioni: applica solo quelle già presenti in `apps/server/prisma/migrations/`. È il comando corretto per qualunque ambiente non-dev.

In pratica: le migrazioni si creano solo in locale con `prisma:migrate`, si committano, e ovunque altrove (CI, docker-compose, eventuale produzione) si applicano con `prisma:migrate:deploy`.

## Docker Compose

```bash
docker compose up --build
```

Avvia:
- `server`: REST API (porta 3000) + server MCP HTTP (porta 3100), nello stesso container (due processi Node lanciati da `apps/server/docker-entrypoint.sh`, che esegue prima `prisma migrate deploy`). SQLite persistito su `./data`, allegati locali su `./attachments`.
- `web`: build statica React servita da nginx (porta 5173), con reverse proxy `/api` → `server:3000` (vedi `apps/web/nginx.conf`), stesso schema del proxy Vite usato in sviluppo.
- `minio` + `minio-init`: storage S3-compatibile per testare `ATTACHMENTS_BACKEND=s3` end-to-end in locale/CI. Usa **SILO** (`pgsty/minio`), fork drop-in di MinIO: le immagini ufficiali MinIO sono state rimosse da Docker Hub (set 2026) e da quay.io (ott 2026). Console su `http://localhost:9001` (credenziali `minioadmin`/`minioadmin` di default, sovrascrivibili con `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`). Il servizio `minio-init` crea automaticamente il bucket di test (`S3_BUCKET`, default `my-planner-attachments`) all'avvio.

Per usare S3 invece dello storage locale, impostare `ATTACHMENTS_BACKEND=s3` (env del servizio `server` in `docker-compose.yml` o variabile d'ambiente della shell prima di `docker compose up`).

## Cloudflare (porting CF)

Oltre allo stack Node/Fastify, il backend è disponibile come **Worker Cloudflare**
(`apps/server/src/cf/`): un unico Worker che serve sia la REST API (Hono) sia MCP
HTTP (transport Web Standard del SDK MCP), con DB su **D1** (Prisma + `@prisma/adapter-d1`)
e allegati su **R2**. Il frontend è pubblicato su **Cloudflare Pages**, con una Pages
Function che inoltra `/api/*` al Worker (al posto del reverse proxy nginx). Vedi
`BACKLOG.md` sezione "PORTING CLOUDFLARE".

Prerequisiti: account Cloudflare, `npx wrangler login`.

```bash
# 1. Provisioning (una tantum)
npx wrangler d1 create my-planner          # copia il database_id in apps/server/wrangler.toml
npx wrangler r2 bucket create my-planner-attachments

# 2. Worker: URL pubblica per gli allegati MCP (vars, non segreta)
#    In apps/server/wrangler.toml: MCP_HTTP_BASE_URL = "https://my-planner.<account>.workers.dev"
#    (o il custom domain). Serve a get_attachment_url per restituire URL raggiungibili.

# 3. Secrets del Worker (produzione)
npx --workspace apps/server wrangler secret put JWT_SECRET
npx --workspace apps/server wrangler secret put BOOTSTRAP_USERNAME
npx --workspace apps/server wrangler secret put BOOTSTRAP_PASSWORD

# 4. Migrazioni D1 (remote) e deploy del Worker (genera anche il client D1)
npm run --workspace apps/server d1:migrate:remote
npm run --workspace apps/server cf:deploy
# -> https://my-planner.<account>.workers.dev  (REST /... e MCP /mcp)

# 5. Frontend su Pages
npx wrangler pages project create my-planner-web --production-branch master
VITE_MCP_HTTP_BASE_URL="https://my-planner.<account>.workers.dev" \
  npm run --workspace apps/web pages:deploy:prod
# -> https://my-planner-web.pages.dev   (la Function /api/* inoltra al Worker)

# Sviluppo locale del Worker (miniflare: D1 + R2 simulati)
cp apps/server/.dev.vars.example apps/server/.dev.vars
npm run --workspace apps/server d1:migrate:local
npm run --workspace apps/server cf:dev
```

Binding Pages → Worker: `apps/web/wrangler.toml` dichiara `[[services]] binding = "API"
service = "my-planner"` (deve combaciare col nome del Worker). Se il deploy non lo
applica, impostalo da dashboard: Pages → progetto → Settings → Functions → Service
bindings → `API` → Worker `my-planner`.

Note di architettura:
- `schema.prisma` genera **due client**: quello classico Node (`@prisma/client`) e
  quello D1/WASM per il Worker (`prisma/d1client`, `driverAdapters` + `engineType=client`).
  I service layer sono condivisi e runtime-agnostici.
- Sul Worker l'accesso al DB è **serializzato** (il query compiler WASM non è rientrante):
  vedi `apps/server/src/cf/db.ts`.
- MCP su Cloudflare usa il transport raw del SDK (`WebStandardStreamableHTTPServerTransport`),
  equivalente Workers di `StreamableHTTPServerTransport` Node, con gli stessi 14 tool e
  autenticazione a token di progetto (`Authorization: Bearer <token>`). MCP stdio resta
  invariato come tool CLI locale.
- L'URL MCP mostrato in UI deriva da `VITE_MCP_HTTP_BASE_URL` (build Pages). Nello stack
  Node/Docker, senza quella variabile, resta `<host UI>:3100` come prima.
- CF15/CF17: `.github/workflows/ci.yml` valida il Worker (typecheck, migrazioni D1 locali,
  bundle `wrangler deploy --dry-run`) e lo deploya su `master`; gli e2e Playwright girano
  contro il Worker con `E2E_CF=1 MCP_HTTP_BASE=http://localhost:3050 npm run --workspace apps/web test:e2e`.

### Runbook aggiornamenti

Variabili di riferimento (produzione attuale):
`WORKER_URL=https://my-planner.giuseppe-concas.workers.dev`, frontend `https://my-planner-web.pages.dev`.

**Backend (Worker) — modifiche a `apps/server/src/cf`, route, service, validation**
1. Verifica locale: `npm run typecheck && npm run --workspace apps/server typecheck:cf && npm run test`
   (facoltativo: `npm run --workspace apps/server cf:dry-run` per il bundle).
2. Se cambi binding/vars: aggiorna `apps/server/wrangler.toml`.
3. Deploy: `npm run --workspace apps/server cf:deploy` (esegue `prisma generate` + `wrangler deploy`).
4. Health check: `GET $WORKER_URL/health` (o `GET https://my-planner-web.pages.dev/api/health`).

**Frontend (Pages) — modifiche a `apps/web`**
1. `npm run --workspace apps/web typecheck && npm run --workspace apps/web build`.
2. Deploy in produzione (da locale):
   `VITE_MCP_HTTP_BASE_URL="$WORKER_URL" npm run --workspace apps/web pages:deploy:prod`.
   (`pages:deploy` senza `--branch` deploya il branch git corrente → solo preview.)
3. Nota: `VITE_MCP_HTTP_BASE_URL` è **build-time**: senza variabile la config MCP in UI
   punta a `<host>:3100` (default stack Node/Docker).

**Database (D1) — modifiche a `apps/server/prisma/schema.prisma`**
Il Worker e Node usano due migrazioni separate: `apps/server/prisma/migrations/` (Prisma/Node)
e `apps/server/migrations/` (D1/Worker). Vanno aggiornate entrambe.
1. Node: `npm run --workspace apps/server prisma:migrate` (crea `prisma/migrations/<ts>_*`).
2. D1: `npx --workspace apps/server wrangler d1 migrations create DB <nome>` e incolla lo
   stesso DDL in `apps/server/migrations/000N_*.sql` (SQLite; prima i data-fix, poi il DDL).
3. Applica a D1 produzione: `npm run --workspace apps/server d1:migrate:remote`.
4. Rigenera i client (entrambi): `npm run --workspace apps/server prisma:generate`.
5. Rideploya il Worker (se cambiano query/servizi): `npm run --workspace apps/server cf:deploy`.

**Secrets (Worker)**
- `npx --workspace apps/server wrangler secret put <NOME>` (es. `JWT_SECRET`).
  Cambiare `JWT_SECRET` invalida le sessioni attive; cambiare `BOOTSTRAP_*` **non** aggiorna
  l'utente già creato (il bootstrap gira solo se la tabella `User` è vuota).

**Reset login (bootstrap del primo admin)**
1. Elimina gli utenti: `npx --workspace apps/server wrangler d1 execute DB --remote --command "DELETE FROM User;"`
2. Imposta nuovi `BOOTSTRAP_USERNAME`/`BOOTSTRAP_PASSWORD` (secrets).
3. Fai una richiesta qualsiasi al Worker (es. `GET /health`): il primo admin viene ricreato.
   Gli altri utenti si gestiscono dalla UI **Utenti** (solo admin).

**Rollback**
- Worker: `npx --workspace apps/server wrangler rollback` (o redeploy del commit precedente).
- Pages: dashboard → progetto → Deployments → "Rollback" a un deployment precedente.
- D1: le migrazioni sono solo forward; per dati usa Time Travel
  (`npx --workspace apps/server wrangler d1 time-travel info DB --remote`).

**CI automatica**: su push a `master`, il job `deploy-cloudflare` applica migrazioni D1,
deploya Worker e Pages in produzione (`pages:deploy:prod`). Lo stesso job può essere
rilanciato manualmente dal tab **Actions → CI → Run workflow** selezionando `master`
(`workflow_dispatch`).

Prerequisiti una tantum nel repository GitHub:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"
gh variable set MCP_HTTP_BASE_URL --body "$WORKER_URL"
```

Senza `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` il job di deploy fallisce con un
errore esplicito prima di toccare la produzione.

## MCP

- **stdio:** `npm run --workspace apps/server mcp:stdio` (richiede `MCP_PROJECT_TOKEN` in env)
- **HTTP:** `npm run --workspace apps/server mcp:http`, poi chiamare `/mcp` con header `Authorization: Bearer <token>`

I token si generano/revocano dalla UI, uno per progetto.

## Standup giornaliero (Cron Trigger + Gmail)

Il Worker CF invia ogni giorno alle 06:00 UTC (`apps/server/wrangler.toml`
`[triggers]`) un riepilogo via email su tutti i progetti non archiviati
(`apps/server/src/cf/standup.ts`): task completati nelle ultime 24h, task
`in_progress` (con giorni di stallo) e task `draft`/`todo` a priorità `high`/`urgent`.
L'invio usa un client SMTP minimale su TCP socket (`apps/server/src/cf/email.ts`,
API `cloudflare:sockets`) verso `smtp.gmail.com:465` (TLS implicita), non l'API
Gmail: autenticazione con una **App Password**, non con la password
dell'account né con OAuth2.

**Setup una tantum:**
1. Sul tuo Account Google, richiede la **verifica in due passaggi attiva**:
   [myaccount.google.com/security](https://myaccount.google.com/security) →
   "Verifica in due passaggi" → in fondo "Password per le app" → genera una
   password per l'app "Mail" (o nome libero, es. "my-planner standup") →
   copia la stringa di 16 caratteri mostrata (senza spazi).
2. Imposta i secrets del Worker:
   ```bash
   npx --workspace apps/server wrangler secret put GMAIL_USER          # es. tuo-indirizzo@gmail.com
   npx --workspace apps/server wrangler secret put GMAIL_APP_PASSWORD  # la stringa da 16 caratteri
   ```
3. `STANDUP_RECIPIENT` è già in `wrangler.toml` (`[vars]`); cambiarlo lì se serve.
4. Deploy: `npm run --workspace apps/server cf:deploy` (applica anche `[triggers]`).

**Test locale** (prima del deploy, senza aspettare l'orario):
```bash
cp apps/server/.dev.vars.example apps/server/.dev.vars   # e compila i valori Gmail
npm run --workspace apps/server cf:dev
# in un altro terminale:
curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"
```

Nota fuso orario: Cloudflare valuta i cron sempre in UTC. `0 6 * * *` = 08:00
locale in ora legale (CEST, mar-ott); in ora solare (CET, nov-mar) diventa
07:00 locale — se serve l'orario locale esatto tutto l'anno, l'espressione
cron va aggiornata a mano ai cambi d'ora.

## Agenti

Definiti in `.claude/agents/`: `analyst`, `architect`, `planner`, `coder`, `reviewer`, `dev-ops`.
Il `planner` è notificato di ogni cambio di stato dei task (`draft → todo → in_progress → testing → done`) e verifica le dipendenze bloccanti.

## Inizializzazione di nuovi progetti

Il prompt generico per inizializzare il workflow di un progetto (qualsiasi
progetto, qualsiasi CLI AI) vive in un repo a parte, per non divergere:
<https://github.com/gyuco/dev-workflow> —
`https://raw.githubusercontent.com/gyuco/dev-workflow/main/prompts/project-init.md`
