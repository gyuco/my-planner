# Sviluppo locale

Istruzioni verificate per avviare `my-planner` in locale (stack Node/Fastify + Vite),
con note su Docker, test e Worker Cloudflare.

Riferimenti: [README.md](./README.md) (panoramica e deploy), [config.example.md](./config.example.md)
(variabili d'ambiente), [API_CONTRACT.md](./API_CONTRACT.md), [prd.md](./prd.md).

---

## 1. Prerequisiti

| Strumento | Versione | Note |
| --- | --- | --- |
| Node.js | 22.x | testato con `v22.16.0` |
| npm | 10.x | `10.9.2` |
| Docker | opzionale | solo per `docker compose` / MinIO |

Il repo usa i **npm workspaces**: `apps/server`, `apps/web`, `packages/core`.
Le dipendenze si installano una sola volta dalla root.

```bash
npm install
```

---

## 2. Configurazione: il file `.env` va in `apps/server/`

Questo è il punto in cui è facile sbagliare: **il `.env` deve stare in `apps/server/.env`**,
non nella root del repo. Il server usa `import "dotenv/config"`, che carica il file dalla
*working directory* del processo; npm esegue gli script workspace con cwd =
`apps/server/`, quindi un `.env` nella root viene **ignorato**.
(Il README indica `cp config.example.md .env` dalla root: quella posizione non funziona
con l'avvio tramite `npm run dev`.)

```bash
cd apps/server
cat > .env <<'EOF'
DATABASE_URL="file:./dev.db"
JWT_SECRET="sostituisci-con-openssl-rand-hex-32"
PORT=3000
MCP_HTTP_PORT=3100
MCP_HTTP_BASE_URL=http://localhost:3100

ATTACHMENTS_BACKEND=local
ATTACHMENTS_LOCAL_DIR=./attachments/local
EOF
```

Genera il segreto con:

```bash
openssl rand -hex 32
```

`apps/server/.env` è già in `.gitignore` (pattern `.env`), non committarlo.

### Note sulle variabili

- **`JWT_SECRET` è obbligatorio**: il server si rifiuta di partire se manca o è vuoto
  (nessun fallback insicuro, vedi `apps/server/src/index.ts`).
- **`DATABASE_URL` relativo a `schema.prisma`**, non alla cwd: `file:./dev.db` →
  `apps/server/prisma/dev.db`. Vale per tutti gli URL `file:` di Prisma.
- **Credenziali di login: nel database, non nel `.env`.** Email e `passwordHash`
  (bcrypt) stanno nella tabella `User` di SQLite. `BOOTSTRAP_EMAIL` /
  `BOOTSTRAP_PASSWORD` non sono "il login": sono solo un seed usato **una volta**, al
  primo avvio e **solo se la tabella `User` è vuota**; non vengono mai rilette dopo.
  Per creare/cambiare l'utente usa lo script su DB descritto in §5.
- **Allegati**: `ATTACHMENTS_BACKEND=local` (default) scrive in `ATTACHMENTS_LOCAL_DIR`.
  Per S3/MinIO vedi §7.
- Al primo salvataggio dalla UI "Impostazioni storage" la configurazione finisce nella
  tabella `StorageSettings` e **ha priorità** sulle variabili d'ambiente.

---

## 3. Avvio in sviluppo

Dalla root del repo:

```bash
npm run dev
```

Avvia in parallelo:

| Servizio | Comando | URL |
| --- | --- | --- |
| API REST (Fastify) | `tsx watch src/index.ts` | <http://localhost:3000> |
| UI React (Vite) | `vite` | <http://localhost:5173> |

Apri **<http://localhost:5173>**: Vite fa da proxy per `/api` → `http://localhost:3000`
(vedi `apps/web/vite.config.ts`), quindi non serve altro.

Health check rapido:

```bash
curl http://localhost:3000/health   # {"status":"ok"}
```

### Consigliato: due terminali separati

Lo script `dev` della root usa `&` per lanciare i due processi; con `Ctrl+C` il backend
può restare orfano sulla porta 3000. In due terminali il controllo è più pulito:

```bash
# terminale 1
npm run --workspace apps/server dev

# terminale 2
npm run --workspace apps/web dev
```

Se una porta resta occupata:

```bash
lsof -ti:3000 | xargs kill
lsof -ti:5173 | xargs kill
```

### Puntare la UI a un backend diverso

`Vite` rispetta due variabili (usate anche dai test e2e):

```bash
VITE_API_PROXY_TARGET=http://localhost:3050 VITE_DEV_PORT=5183 \
  npm run --workspace apps/web dev
```

---

## 4. Database e migrazioni

DB di sviluppo: **SQLite** in `apps/server/prisma/dev.db` (gitignorato).

```bash
# applica le migrazioni esistenti / crea una nuova migrazione (interattivo, solo dev)
npm run --workspace apps/server prisma:migrate
```

Comandi da non confondere:

| Comando | Uso |
| --- | --- |
| `prisma:migrate` (`prisma migrate dev`) | **solo sviluppo locale**: applica e crea nuove migrazioni |
| `prisma:migrate:deploy` (`prisma migrate deploy`) | CI / Docker / produzione: applica solo migrazioni già committate |

Se cambi `schema.prisma`:

```bash
npm run --workspace apps/server prisma:migrate   # genera prisma/migrations/<ts>_*
npm run --workspace apps/server prisma:generate  # rigenera i client (Node + D1)
```

Ricorda che il porting Cloudflare usa **un secondo set di migrazioni** in
`apps/server/migrations/` (D1): vanno aggiornate entrambe. Dettagli nel README
(sezione "Runbook aggiornamenti").

Ispezione veloce del DB:

```bash
sqlite3 apps/server/prisma/dev.db ".tables"
sqlite3 apps/server/prisma/dev.db "select id, email from User;"
```

---

## 5. Login: gestione dell'utente sul database

L'app supporta **più utenti** con ruoli diversi, salvati nella tabella `User` di
`apps/server/prisma/dev.db` (`email`, `passwordHash` bcrypt, `role`). Il ruolo
`admin` ha accesso a tutti i progetti e alla gestione utenti; il ruolo `manager`
accede solo ai progetti associati in `UserProject`. L'autenticazione legge sempre
dal DB: nessuna credenziale sta nel `.env`. Il primo utente creato (bootstrap o
script) è sempre amministratore; gli altri si creano dalla UI **Utenti** (solo admin).

### Creare il primo utente o reimpostare una password

```bash
npm run --workspace apps/server user:set-password -- admin@example.com admin123
```

Comportamento (`apps/server/scripts/set-user-password.mjs`):

- DB senza utenti → **crea** l'utente indicato con ruolo `admin`.
- utente esistente con quella email → **aggiorna** la passwordHash.
- email inesistente con altri utenti presenti → errore (crea gli utenti dalla UI admin).
- password di almeno 8 caratteri; `DATABASE_URL` letta da `apps/server/.env`.

Non serve riavviare il server: il login successivo usa già il nuovo hash.

Verifica manuale:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}'
# -> {"token":"eyJ...","user":{"id":"...","email":"admin@example.com","role":"admin","projectIds":[]}}   (401 se le credenziali sono errate)
```

Ispezione della riga (senza password in chiaro, solo hash):

```bash
sqlite3 apps/server/prisma/dev.db "select id, email, role, substr(passwordHash,1,15)||'...' from User;"
```

### Reset totale del DB di sviluppo

Perde tutti i dati locali (progetti, task, token MCP):

```bash
rm apps/server/prisma/dev.db
npm run --workspace apps/server prisma:migrate
npm run --workspace apps/server user:set-password -- admin@example.com admin123
```

In alternativa, su un DB vuoto funziona ancora il seed da env (`BOOTSTRAP_EMAIL` /
`BOOTSTRAP_PASSWORD` in `apps/server/.env` o secrets Wrangler): utile in CI/e2e e per il
Worker Cloudflare, non necessario in sviluppo.

---

## 6. Test, typecheck, lint

```bash
# test unitari/integrazione (Vitest, tutti i workspace)
npm test

# solo server
npm run --workspace apps/server test

# typecheck (server, web + Pages Functions, core)
npm run typecheck

# typecheck del Worker Cloudflare
npm run --workspace apps/server typecheck:cf

# lint (dove definito: apps/web → tsc --noEmit)
npm run lint

# build completo (core → server → web)
npm run build
```

I test del server **non toccano `dev.db`**: `vitest.config.ts` usa un SQLite dedicato
(`apps/server/prisma/prisma/test.db`, percorso relativo allo schema) e `test/globalSetup.ts`
lo ricrea a ogni run.

### E2E Playwright

```bash
npm run --workspace apps/web test:e2e
```

Lo suite è **autosufficiente**: `playwright.config.ts` avvia da solo backend e frontend
con porte dedicate e un DB e2e separato (mai `dev.db`).

| Modalità | Backend | Frontend | Come si attiva |
| --- | --- | --- | --- |
| default | REST 3050, MCP 3150 | 5183 | — |
| storage S3 | REST 3051, MCP 3151 | 5184 | `E2E_S3=1` + MinIO attivo |
| Worker CF | 3050 (Worker) | 5183 | `E2E_CF=1` |

```bash
# scenario S3 (richiede lo storage S3-compatibile di docker-compose sulla 9000)
docker compose up -d minio && docker compose run --rm minio-init
E2E_S3=1 npm run --workspace apps/web test:e2e

# scenario Cloudflare (Worker via wrangler dev)
E2E_CF=1 MCP_HTTP_BASE=http://localhost:3050 npm run --workspace apps/web test:e2e
```

---

## 7. Storage allegati

### Locale (default)

```env
ATTACHMENTS_BACKEND=local
ATTACHMENTS_LOCAL_DIR=./attachments/local
```

I file finiscono in `apps/server/attachments/local/` (gitignorato).

### S3 compatibile / MinIO

```env
ATTACHMENTS_BACKEND=s3
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=my-planner-attachments
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_REGION=us-east-1
```

Storage S3 locale (dal `docker-compose.yml`, solo i servizi di storage; usa
SILO/`pgsty/minio`, fork drop-in di MinIO):

```bash
docker compose up -d minio && docker compose run --rm minio-init
# console web: http://localhost:9001 (minioadmin / minioadmin)
```

---

## 8. MCP in locale

I token MCP sono **per progetto** e si generano/revocano dalla UI.
Entrambi i transport richiedono `DATABASE_URL` (leggono dal DB di sviluppo).

### stdio (Claude Code / Desktop)

```bash
MCP_PROJECT_TOKEN=<token> npm run --workspace apps/server mcp:stdio
```

Configurazione tipica del client MCP (esempio Claude Desktop/Code):

```json
{
  "mcpServers": {
    "my-planner": {
      "command": "npm",
      "args": ["run", "--workspace", "apps/server", "mcp:stdio"],
      "cwd": "/percorso/assoluto/my-planner",
      "env": { "MCP_PROJECT_TOKEN": "<token>" }
    }
  }
}
```

### HTTP

```bash
npm run --workspace apps/server mcp:http   # porta MCP_HTTP_PORT (default 3100)
```

Endpoint: `POST http://localhost:3100/mcp` con header `Authorization: Bearer <token>`.

L'URL mostrato nella UI deriva da `VITE_MCP_HTTP_BASE_URL` (build-time); senza quella
variabile resta `<host UI>:3100`, corretto per lo stack locale.

---

## 9. Alternativa: Docker Compose

Non richiede Node locale né `.env` (i valori di default sono nel compose).

```bash
docker compose up --build
```

| Servizio | Porta | Note |
| --- | --- | --- |
| `web` | 5173 | build statica React servita da nginx, proxy `/api` → `server:3000` |
| `server` | 3000 | REST API |
| `server` | 3100 | MCP HTTP |
| `minio` | 9000 / 9001 | storage S3 (console su 9001) |

Al boot il container `server` esegue `prisma migrate deploy`
(`apps/server/docker-entrypoint.sh`), quindi non serve lanciare migrazioni a mano.
Dati persistiti su `./data`, allegati su `./attachments`.

Credenziali di default: `admin@example.com` / `admin-change-me` (override con
`BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD`). Cambia anche `JWT_SECRET`:

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Per usare S3 invece dello storage locale:

```bash
ATTACHMENTS_BACKEND=s3 docker compose up --build
```

---

## 10. Worker Cloudflare in locale (opzionale)

Simula D1 + R2 con miniflare: utile per lavorare su `apps/server/src/cf/`.
Non usa `.env`, ma `apps/server/.dev.vars` (gitignorato).

```bash
cp apps/server/.dev.vars.example apps/server/.dev.vars
# compila JWT_SECRET, BOOTSTRAP_*, ed eventualmente GMAIL_* per lo standup

npm run --workspace apps/server d1:migrate:local
npm run --workspace apps/server cf:dev
# -> http://localhost:8787  (REST su /... e MCP su /mcp)
```

Nota: `DATABASE_URL`, `ATTACHMENTS_BACKEND` e `S3_*` non servono sul Worker; DB = binding
D1 `DB`, allegati = binding R2 `ATTACHMENTS`.

Test manuale dello standup giornaliero (con `cf:dev` attivo):

```bash
curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"
```

---

## 11. Troubleshooting

| Sintomo | Causa | Soluzione |
| --- | --- | --- |
| `Errore fatale: la variabile d'ambiente JWT_SECRET non e' impostata` | `.env` assente o nella posizione sbagliata | crea `apps/server/.env` (§2) |
| `Environment variable not found: DATABASE_URL` | `.env` nella root invece che in `apps/server/` | sposta il file in `apps/server/.env` |
| `Credenziali non valide` al login | password diversa da quella salvata nel DB | `npm run --workspace apps/server user:set-password -- admin@example.com <password>` (§5) |
| `EADDRINUSE :3000` / `:5173` | processo precedente ancora vivo (spesso per il `&` dello script root) | `lsof -ti:3000 \| xargs kill` |
| UI carica ma le chiamate API falliscono | backend non avviato / porta diversa | controlla `curl :3000/health`, poi `VITE_API_PROXY_TARGET` |
| `502`/`404` sugli allegati | `ATTACHMENTS_LOCAL_DIR` non scrivibile o backend S3 non raggiungibile | verifica la dir / `docker compose up -d minio && docker compose run --rm minio-init` |
| Migrazioni non applicate dopo un pull | nuove migrazioni committate | `npm run --workspace apps/server prisma:migrate` |
| `tsx`/`vite` non trovati | `npm install` non eseguito | `npm install` dalla root |

---

## 12. Riepilogo comandi

```bash
npm install                                        # setup una tantum
cp config.example.md apps/server/.env             # poi modifica i valori
npm run --workspace apps/server prisma:migrate     # DB di sviluppo
npm run --workspace apps/server user:set-password -- admin@example.com admin123  # login (nel DB)
npm run dev                                        # API :3000 + UI :5173
npm test                                           # test
npm run typecheck                                  # typecheck
docker compose up --build                          # alternativa container
```
