# PRD — my-planner

## 1. Panoramica
Gestore di progetti e task personale, classico, con board Kanban, utilizzabile in modo equivalente da **UI web** e da **server MCP** (agenti AI come Claude Code). Utente singolo con login semplice.

## 2. Problema e utenti
**Problema:** serve un sistema di gestione task comodo da usare a mano e pienamente pilotabile da un agente AI, con priorità, complessità, subtask e dipendenze bloccanti.

**Utente:** un singolo utente (il proprietario), autenticato via login. Nessun multi-utente, nessun assegnatario, nessun ruolo.

**Canali d'uso:** UI e MCP **alla pari** — ogni operazione disponibile in UI è disponibile via MCP e viceversa.

## 3. Autenticazione e accesso
- **UI/REST:** login singolo utente (username/password), sessione via **JWT**. Tutte le route REST richiedono JWT valido tranne `/auth/login`.
  - **Bootstrap utente:** al primo avvio, se non esiste nessun utente, il server lo crea leggendo username/password da variabili d'ambiente. Nessuna registrazione self-service, nessun comando manuale richiesto.
  - **Scadenza JWT:** token a lunga scadenza (es. 30 giorni), senza refresh token né blacklist — coerente con utente singolo locale a basso rischio.
- **MCP:** autenticazione separata tramite **token per progetto**. Un token dà accesso a un solo progetto. I token si creano/revocano dalla UI (Impostazioni progetto → Token MCP).
  - `get_aggregated_board` **non è esposto via MCP** (incompatibile con lo scope a singolo progetto del token): resta una funzionalità solo UI/JWT. Via MCP resta `get_board`, scoped al progetto del token.
  - Per lo stesso motivo, anche la **gestione progetti** (creare/rinominare/archiviare/ripristinare) resta solo UI/JWT: non è esposta via MCP.
  - **Transizioni di stato:** libere in entrambe le direzioni (`draft ↔ in_progress ↔ done`); l'unico vincolo è il blocco per dipendenze non risolte all'ingresso in `in_progress`.
  - **Download allegati via MCP:** stesso token MCP del progetto, nessuna autenticazione aggiuntiva.
  - **Archiviazione progetto:** reversibile (azione di ripristino disponibile).

## 4. Funzionalità v1

### Progetti
- Creare, rinominare, archiviare/ripristinare progetti
- Ogni progetto ha la propria board Kanban
- Ogni progetto ha uno o più token MCP associati

### Task
- Titolo, descrizione in markdown, stato, priorità, complessità, tag, data di scadenza
- **Stati:** `draft` → `in progress` → `done`
- **Priorità:** `low` / `medium` / `high` / `urgent`
- **Complessità:** Fibonacci — `1, 2, 3, 5, 8, 13, 21`
- **Subtask:** gerarchia padre/figlio con indicatore di avanzamento (es. `2/5`)
- **Dipendenze:** relazioni "bloccata da" / "blocca" tra task
  - Un task con bloccanti non ancora `done` non può passare a `in progress`; il blocco è visibile in UI e l'MCP restituisce un errore esplicito
  - Le dipendenze circolari sono rifiutate
- **Commenti/note** cronologici sul task
- **Allegati:** upload e download di file per task
- **Eliminazione:** cancellare un task elimina in cascata subtask, commenti, allegati e le dipendenze che lo coinvolgono

### Board Kanban
- Board per singolo progetto: tre colonne (`draft`/`in progress`/`done`), drag & drop, ordinamento manuale
- **Vista aggregata multi-progetto:** board unica su tutti i progetti (o un sottoinsieme selezionato), ogni card etichettata col progetto di appartenenza
- Filtri per priorità, tag, progetto e ricerca testuale (su titolo e descrizione, case-insensitive)

### Allegati — storage pluggabile
- Backend **locale** (filesystem) o **cloud** (S3-compatibile), scelto via configurazione
- Limiti: max **20MB** per file; tipi ammessi: immagini, PDF, documenti Office, testo/markdown, zip. Eseguibili e script bloccati.

### Server MCP
Transport: **stdio** (Claude Code/Desktop locali) e **HTTP** (uso remoto). Autenticazione via token di progetto.

Tool esposti, con parità funzionale rispetto alla UI:
- Task: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `move_task`
- Subtask: `add_subtask`, `list_subtasks`, `update_subtask`
- Dipendenze: `add_dependency`, `remove_dependency`, `list_blockers`
- Commenti: `add_comment`, `list_comments`
- Allegati: `list_attachments`, `attach_file`, `get_attachment_url`
- Board: `get_board` (scoped al progetto del token — nessun equivalente aggregato via MCP)

### UI mobile
- Web responsive, usabile da browser smartphone. Nessuna app nativa.

## 5. Fuori scope (v1)
- Multi-utente, ruoli, permessi, assegnatari
- Time tracking e timesheet
- Notifiche (email, push, Slack)
- Gantt, roadmap, calendario, sprint con velocity
- Integrazioni esterne (GitHub, Jira, Google Calendar)
- Report e dashboard di analytics
- App mobile nativa
- Automazioni e regole condizionali

## 6. Stack tecnico
- **Backend:** Node.js + TypeScript, Fastify
- **Database:** SQLite + Prisma ORM
- **Frontend:** React + TypeScript + Vite (SPA), `@dnd-kit`, CSS responsive (Tailwind)
- **Monorepo:** `apps/server`, `apps/web`, `packages/core` (tipi e business logic condivisi)
- **MCP:** `@modelcontextprotocol/sdk`, stesso service layer di REST/UI; transport stdio + HTTP
- **Allegati:** storage pluggabile — filesystem locale o S3-compatibile via config
- **Deploy:** locale (docker-compose / npm run dev); nessun ambiente cloud gestito in v1
- **Testing:** Vitest (unit, incluso i tool MCP), Playwright (e2e sui flussi critici)
- **CI/CD:** GitHub Actions — lint, typecheck, test ad ogni push; nessun deploy automatico
- **Repo:** pubblicato su GitHub

## 7. Workflow / agenti
- **analyst** — raffina requisiti, scompone feature in task/subtask con priorità e complessità
- **architect** — decisioni di design tecnico, schema DB, contratti API/MCP
- **planner** — riceve ogni cambio di stato (`draft → in progress → done`), verifica dipendenze/blocchi e mantiene coerente il workflow
- **coder** — implementa feature/fix
- **reviewer** — code review su correttezza, sicurezza, coerenza col PRD
- **dev-ops** — CI/CD, Docker, migrazioni Prisma

## 8. Criteri di accettazione
1. Creo un progetto e vedo la board con le colonne `draft / in progress / done`
2. Creo un task con titolo, descrizione, priorità, complessità Fibonacci, tag e scadenza
3. Aggiungo subtask a un task e ne vedo l'avanzamento (es. `2/5`)
4. Dichiaro che A è bloccato da B; l'app impedisce/segnala chiaramente lo spostamento di A in `in progress` finché B non è `done`
5. Sposto i task tra colonne in drag & drop e lo stato persiste dopo un reload
6. Allego un file a un task e lo riscarico, sia con storage locale sia cloud, cambiando solo la configurazione
7. Da Claude Code, via MCP (stdio o HTTP) con token di progetto, eseguo tutte le stesse operazioni e le modifiche compaiono nella UI
8. Login funziona, JWT protegge le route REST, ogni progetto ha token MCP dedicati e revocabili
9. Vedo una board aggregata con i task di tutti i progetti
10. La UI è usabile da smartphone (board scrollabile, form leggibili)
11. Il progetto parte in locale con un solo comando e i dati sopravvivono al riavvio
