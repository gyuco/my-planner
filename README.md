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

```bash
npm install
cp config.example.md .env   # poi modifica i valori (vedi config.example.md)
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
- `minio` + `minio-init`: storage S3-compatibile per testare `ATTACHMENTS_BACKEND=s3` end-to-end in locale/CI. Console su `http://localhost:9001` (credenziali `minioadmin`/`minioadmin` di default, sovrascrivibili con `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`). Il servizio `minio-init` crea automaticamente il bucket di test (`S3_BUCKET`, default `my-planner-attachments`) all'avvio.

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
  npm run --workspace apps/web pages:deploy
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

## MCP

- **stdio:** `npm run --workspace apps/server mcp:stdio` (richiede `MCP_PROJECT_TOKEN` in env)
- **HTTP:** `npm run --workspace apps/server mcp:http`, poi chiamare `/mcp` con header `Authorization: Bearer <token>`

I token si generano/revocano dalla UI, uno per progetto.

## Agenti

Definiti in `.claude/agents/`: `analyst`, `architect`, `planner`, `coder`, `reviewer`, `dev-ops`.
Il `planner` è notificato di ogni cambio di stato dei task (`draft → in_progress → done`) e verifica le dipendenze bloccanti.

## Inizializzazione di nuovi progetti

Il prompt generico per inizializzare il workflow di un progetto (qualsiasi
progetto, qualsiasi CLI AI) vive in un repo a parte, per non divergere:
<https://github.com/gyuco/dev-workflow> —
`https://raw.githubusercontent.com/gyuco/dev-workflow/main/prompts/project-init.md`
