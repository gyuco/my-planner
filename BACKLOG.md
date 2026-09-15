# Backlog v1 — my-planner

Generato dal `planner` a partire da `prd.md`. Priorità: low/medium/high/urgent. Complessità: Fibonacci (1,2,3,5,8,13,21).

> **Nota (2026-09-15):** il concetto di "subtask" (gerarchia padre/figlio tra task) è stato rimosso dal prodotto su richiesta esplicita dell'utente. I riferimenti a subtask nei task già completati sotto restano come cronologia dell'implementazione originale ma non riflettono più lo stato attuale del codice (vedi `prd.md` e `API_CONTRACT.md` aggiornati).

Decisioni chiuse durante la revisione del backlog (già integrate in `prd.md`):
- `get_aggregated_board` **non** esposto via MCP — solo `get_board` scoped al token di progetto
- Utente unico creato al bootstrap da variabili d'ambiente, nessuna registrazione
- JWT a lunga scadenza (~30gg), nessun refresh token
- Cancellare un task fa cascade su commenti/allegati/dipendenze
- Allegati: max 20MB, tipi comuni (immagini, PDF, Office, testo/markdown, zip)
- Ricerca testuale: titolo + descrizione, case-insensitive
- Formato esatto di endpoint/schemi REST e MCP: da fissare da `architect` prima dell'implementazione di B6-B8 e B14-B15

---

## BACKEND

### B1 — Setup monorepo e packages/core (tipi condivisi)
Struttura npm workspaces, tsconfig condivisi, tipi TS per Project/Task/Comment/Attachment/TaskDependency/ProjectToken/User coerenti con lo schema Prisma.
- Priorità: urgent · Complessità: 3 · Dipendenze: nessuna

### B2 — Setup Prisma + schema DB + migrazione iniziale
Prisma su SQLite, prima migrazione, script `prisma:migrate`/`prisma:generate`, seed opzionale dev.
- Priorità: urgent · Complessità: 2 · Dipendenze: B1

### B3 — Bootstrap server Fastify
App Fastify base: plugin, error handler globale, logging, CORS, config da `.env`.
- Priorità: urgent · Complessità: 2 · Dipendenze: B1

### B4 — Autenticazione JWT (utente singolo)
`/auth/login`, hashing password, JWT a lunga scadenza senza refresh, middleware di verifica su tutte le route tranne login, bootstrap utente da env al primo avvio.
- Priorità: urgent · Complessità: 5 · Dipendenze: B2, B3
- Subtask: hashing/verifica password · generazione/validazione JWT · middleware `preHandler` · bootstrap utente da env

### B5 — Service layer condiviso (business logic)
CRUD progetti/task/commenti/dipendenze, validazione transizioni di stato, validazione dipendenze (rifiuto cicli), cascade su delete.
- Priorità: urgent · Complessità: 8 · Dipendenze: B2
- Subtask: service Progetti · service Task · service Dipendenze (cicli + blocco transizione) · service Commenti

### B6 — REST API Progetti
`/projects`: list, create, update/rename, archive, unarchive.
- Priorità: high · Complessità: 3 · Dipendenze: B4, B5

### B7 — REST API Task, Dipendenze, Commenti
CRUD/move task, dipendenze (con errore esplicito su blocco/ciclo), commenti.
- Priorità: high · Complessità: 8 · Dipendenze: B5, B6
- Subtask: Task CRUD+move con position · Dipendenze · Commenti

### B8 — REST API Board (singola + aggregata) e filtri
Board per progetto e board aggregata multi-progetto, filtri priorità/tag/progetto/ricerca testuale (titolo+descrizione).
- Priorità: high · Complessità: 5 · Dipendenze: B7

### B9 — Storage allegati pluggabile: interfaccia + backend locale
Interfaccia `AttachmentStorage` (upload/download/delete/getUrl) + implementazione filesystem locale.
- Priorità: high · Complessità: 5 · Dipendenze: B5

### B10 — Storage allegati: backend S3-compatibile
Implementazione S3-compatibile della stessa interfaccia.
- Priorità: medium · Complessità: 5 · Dipendenze: B9

### B11 — REST API Allegati
Upload/list/download, validazione dimensione (20MB) e tipo file, delega al backend configurato.
- Priorità: high · Complessità: 5 · Dipendenze: B7, B9

### B12 — Gestione token MCP per progetto (REST)
Create/list/revoke token per progetto, hashing token salvato, token in chiaro mostrato solo alla creazione.
- Priorità: high · Complessità: 5 · Dipendenze: B6

### B13 — Autenticazione MCP via token di progetto
Validazione token contro `ProjectToken`, risoluzione progetto, gestione token revocato.
- Priorità: high · Complessità: 3 · Dipendenze: B12

### B14 — Server MCP: tool Task
`list_tasks, get_task, create_task, update_task, delete_task, move_task` (transizioni di stato libere in entrambe le direzioni, unico vincolo il blocco dipendenze per `in_progress`). **Nessun tool di gestione progetti via MCP** (resta solo REST/UI, come `get_aggregated_board`).
- Priorità: high · Complessità: 5 · Dipendenze: B5, B13

### B15 — Server MCP: tool Dipendenze, Commenti, Allegati, Board
`add_dependency, remove_dependency, list_blockers, add_comment, list_comments, list_attachments, attach_file, get_attachment_url, get_board`. **Nessun `get_aggregated_board` via MCP.**
- Priorità: high · Complessità: 8 · Dipendenze: B14, B11

### B16 — Transport MCP stdio
`apps/server/src/mcp/stdio.ts`, `MCP_PROJECT_TOKEN` da env.
- Priorità: high · Complessità: 3 · Dipendenze: B14

### B17 — Transport MCP HTTP
Endpoint `/mcp`, `Authorization: Bearer <token>`.
- Priorità: high · Complessità: 3 · Dipendenze: B14

### B18 — Validazione dipendenze circolari e regole di stato (hardening)
Rifiuto cicli (anche indiretti), messaggi di errore consistenti REST/MCP, cascade delete corretto su dipendenze/allegati orfani.
- Priorità: high · Complessità: 5 · Dipendenze: B5, B7, B15

---

## FRONTEND

### F1 — Setup app React + Vite + Tailwind
SPA, routing, layout shell, client HTTP, stato globale (auth token, progetto corrente).
- Priorità: urgent · Complessità: 3 · Dipendenze: B1

### F2 — Pagina login e gestione sessione JWT
Form login, storage JWT, redirect su token scaduto/mancante, logout.
- Priorità: urgent · Complessità: 3 · Dipendenze: F1, B4

### F3 — Shell applicativa e navigazione progetti
Lista progetti, selezione progetto corrente, navigazione board/vista aggregata, pagina impostazioni progetto.
- Priorità: high · Complessità: 5 · Dipendenze: F2, B6

### F4 — Board Kanban con drag & drop
3 colonne, `@dnd-kit`, drag&drop + riordino, persistenza su reload, feedback su tentativo di sblocco non valido.
- Priorità: urgent · Complessità: 8 · Dipendenze: F3, B8
- Subtask: rendering colonne/card · drag&drop+riordino · gestione errore di blocco

### F5 — Card task
Badge priorità, complessità Fibonacci, tag, indicatore dipendenze bloccanti.
- Priorità: high · Complessità: 5 · Dipendenze: F4

### F6 — Modale creazione task
Titolo, descrizione markdown, priorità, complessità, tag, scadenza, progetto/colonna.
- Priorità: high · Complessità: 5 · Dipendenze: F3, B7

### F7 — Drawer dettaglio task
Editing campi, dipendenze (bloccata da/blocca), commenti, allegati.
- Priorità: urgent · Complessità: 13 · Dipendenze: F5, B7, B11
- Subtask: campi principali · dipendenze · commenti · allegati

### F8 — Vista aggregata multi-progetto
Board unica su progetti selezionati, card etichettate col progetto. (Solo UI/JWT, non disponibile via MCP.)
- Priorità: high · Complessità: 8 · Dipendenze: F4, B8

### F9 — Filtri board
Priorità, tag, progetto, ricerca testuale (titolo+descrizione), su board singola e aggregata.
- Priorità: medium · Complessità: 3 · Dipendenze: F4, F8

### F10 — Gestione token MCP in UI
Creazione (visualizzazione one-time del token), elenco con stato, revoca.
- Priorità: high · Complessità: 5 · Dipendenze: F3, B12

### F11 — Gestione progetti in UI
Creazione, rinomina, archiviazione.
- Priorità: high · Complessità: 3 · Dipendenze: F3, B6

### F12 — Responsive mobile
Board scrollabile, drawer/modali e form leggibili su viewport mobile.
- Priorità: medium · Complessità: 5 · Dipendenze: F4, F6, F7

---

## INFRA

Rifinito da `planner` sullo stato reale del codice (route separate in projects/tasks/board/attachments.ts, due transport MCP stdio+http, attachmentStorage pluggabile local/s3, validazione zod condivisa). Decisione utente: MinIO in docker-compose/CI per testare davvero il backend S3.

### I1 — Docker Compose per sviluppo/produzione locale
`docker-compose.yml` (root) esiste già e definisce i servizi `server`/`web` con volumi `./data` (SQLite) e `./attachments` (storage locale), ma referenzia `apps/server/Dockerfile` e `apps/web/Dockerfile` che non esistono ancora. Task: creare i due Dockerfile mancanti (multi-stage: build con `npm run build --workspace ...`, runtime minimale), verificare che il compose funzioni end-to-end (`docker compose up`), allineare porte (3000 REST, 3100 MCP HTTP, 5173 web) ed env a `config.example.md`. Aggiungere anche un servizio **MinIO** (S3-compatibile) al compose, con bucket di test creato all'avvio, per poter eseguire `ATTACHMENTS_BACKEND=s3` end-to-end in locale/CI (decisione utente, vedi T6).
- Priorità: high · Complessità: 8 (rivista da 5, include MinIO) · Dipendenze: B3, F1
- Subtask: Dockerfile `apps/server` (con `prisma generate`+`migrate deploy` all'avvio) · Dockerfile `apps/web` · verifica/allineamento `docker-compose.yml` e volumi persistenti · servizio MinIO + bucket di test

### I2 — CI GitHub Actions
`.github/workflows/ci.yml` esiste già ma è generico e incompleto. Task: estenderlo per farlo corrispondere allo stack reale — step `prisma generate`+`migrate deploy` su DB SQLite effimero prima di typecheck/build/test del server; env minime (`DATABASE_URL`, `JWT_SECRET`); aggiungere script `lint`/`test` mancanti in `apps/web/package.json` (oggi `--if-present` li salta silenziosamente); step Playwright (`npx playwright install --with-deps`) e job e2e che avvia server+web+MinIO; nessun deploy automatico.
- Priorità: high · Complessità: 5 (rivista da 3) · Dipendenze: T1, T2

### I3 — Gestione migrazioni Prisma in dev/CI/docker-compose
Migrazioni già presenti (`init`, `attachment_size`) create con `prisma migrate dev`. Manca uno script esplicito `prisma:migrate:deploy` (usa `prisma migrate deploy`, non interattivo) da usare in CI (I2) e nel Dockerfile server (I1). Documentare in README il flusso dev vs CI/produzione vs docker-compose.
- Priorità: medium · Complessità: 3 · Dipendenze: B2, I1

---

## TEST

### T1 — Unit Vitest: service layer e validazione zod
`apps/server/src/services/taskService.ts` (progetti/task/dipendenze incl. cicli e blocco stato/commenti/board) e `attachmentService.ts`. Aggiunto: test degli schemi condivisi in `lib/validation.ts` (coerenza errori REST/MCP su input malformati).
- Priorità: high · Complessità: 5 · Dipendenze: B5
- Subtask: service progetti/task · service dipendenze (cicli+blocco transizione) · service commenti · attachmentService · schemi zod (validation.ts)

### T2 — Unit Vitest: tool MCP
Testare `createProjectMcpServer` (`mcp/server.ts`) in-process: tool task/dipendenze/commenti/allegati/board, risoluzione token via `mcp/auth.ts` (auth fallita/token revocato), errore su blocco dipendenze. Più un test minimale di wiring per ciascun transport (`mcp/stdio.ts`, `mcp/http.ts`).
- Priorità: high · Complessità: 5 · Dipendenze: B14, B15, B16, B17

### T3 — Unit Vitest: storage allegati pluggabile
Interfaccia `AttachmentStorage` (`lib/attachmentStorage/types.ts`) per `local.ts` e `s3.ts` (mock client `@aws-sdk/client-s3`), più test di `getAttachmentStorage()` (selezione backend via `ATTACHMENTS_BACKEND`).
- Priorità: medium · Complessità: 3 · Dipendenze: B9, B10

### T4 — E2E Playwright: login e board base
Nessuna configurazione Playwright esiste ancora in `apps/web`. Task include il bootstrap: installazione `@playwright/test`, config base, poi gli scenari: login, creazione progetto, board, creazione task, drag&drop (dnd-kit), persistenza dopo reload.
- Priorità: high · Complessità: 8 (rivista da 5, include setup Playwright) · Dipendenze: F2, F4, F6
- Subtask: bootstrap Playwright (config, script npm/CI) · scenario login+board+creazione task · scenario drag&drop+persistenza

### T5 — E2E Playwright: dipendenze, blocco stato
Dipendenza A bloccato da B, verifica blocco/sblocco, incluso il controllo stato esplicito nel drawer (non solo drag&drop). (Rinominato da "T5 — subtask, dipendenze, blocco stato": la parte subtask è stata rimossa insieme alla feature, vedi nota a inizio file.)
- Priorità: high · Complessità: 5 · Dipendenze: F7, T4

### T6 — E2E Playwright: allegati locale e S3
Upload/download con storage locale (`ATTACHMENTS_BACKEND=local`), poi con `ATTACHMENTS_BACKEND=s3` contro il container **MinIO** aggiunto in I1 (decisione utente), cambiando solo configurazione — nessuno stub/mock in questo scenario e2e.
- Priorità: medium · Complessità: 5 · Dipendenze: F7, B10, I1

### T7 — E2E Playwright: MCP end-to-end verso UI
Da MCP (stdio via `mcp/stdio.ts` con `MCP_PROJECT_TOKEN`, e HTTP via `mcp/http.ts` con `Authorization: Bearer <token>`), CRUD, verifica riflesso in UI.
- Priorità: high · Complessità: 5 · Dipendenze: B16, B17, F4

### T8 — E2E Playwright: vista aggregata e token MCP UI
Board aggregata multi-progetto (incl. selezione sottoinsieme progetti), creazione/revoca token via `ProjectSettingsModal`, verifica che token revocato non funzioni più via MCP.
- Priorità: medium · Complessità: 5 · Dipendenze: F8, F10, T7

### T9 — E2E Playwright: responsive mobile
Board/drawer/form su viewport mobile (device emulation Playwright).
- Priorità: low · Complessità: 3 · Dipendenze: F12

---

## Debito tecnico noto (da review B1-B18)

Segnalato da `reviewer`, non bloccante per la v1, da rivedere in un secondo momento:
- `remove_dependency` (MCP) verifica lo scoping progetto solo su `taskId`, non su `blockedByTaskId` (non sfruttabile in pratica, ma incoerente per difesa in profondità)
- Gestione token MCP (`routes/projects.ts`) accede a Prisma direttamente invece che tramite un service dedicato, diversamente dal resto del dominio
- Nessun rate limiting su `/auth/login` (accettabile per utente singolo locale)
- Magic-byte check sugli allegati è minimale (non rileva script testuali/macro Office/eseguibili in zip)

## Debito tecnico noto (da review frontend F1-F12)

Segnalato da `reviewer`, non bloccante, da rivedere in un secondo momento:
- `downloadAttachment` in `api.ts` non centralizza la gestione 401 come `apiFetch` (l'utente vede un errore invece del redirect a login su token scaduto)
- Branch ridondante in `KanbanBoard.handleDrop`; errore di rete generico non mostrato in caso di fetch fallita
- Modale creazione task non permette di scegliere lo stato/colonna iniziale (nasce sempre in `draft`)
- `PRIORITY_LABEL` duplicato tra `TaskCard.tsx` e `FilterBar.tsx`; `buildQuery` non riusato in `getAggregatedBoard`
