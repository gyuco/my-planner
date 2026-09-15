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
