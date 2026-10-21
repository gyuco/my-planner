# API_CONTRACT — my-planner

Contratto tecnico REST + MCP, prodotto dall'`architect` prima dell'implementazione di B6-B8 (REST) e B14-B15 (MCP). Vincolante per `coder`. Ogni decisione qui rispetta `prd.md` e `BACKLOG.md`.

Principio cardine: REST e MCP condividono lo stesso service layer (`apps/server/src/services/*`). Questo documento fissa solo la forma esterna (trasporto, auth, JSON, errori); la logica di business vive nei services.

---

## 0. Convenzioni generali

- **Date**: sempre stringhe **ISO 8601 UTC** con offset `Z` (es. `2026-09-15T10:30:00.000Z`). Mai timestamp numerici in request/response JSON. `dueDate` può essere `null`.
- **Markdown**: `Task.description` e `Comment.body` sono **plain text markdown grezzo**. Il server non fa parsing/sanitizzazione/rendering markdown: salva e restituisce la stringa così com'è. Il rendering (se previsto) è responsabilità del client (web UI). Limite dimensione: nessun limite applicativo esplicito in v1 oltre ai limiti SQLite/Fastify body size di default.
- **Tag**: rappresentati in `packages/core` come `string[]`; persistiti in Prisma come CSV (`tags: String`, campo già esistente). Il service layer fa la conversione; REST/MCP vedono sempre array.
- **ID**: stringhe `cuid()`.
- **Content-Type**: `application/json` per tutte le request/response REST tranne upload/download allegati (`multipart/form-data` upload, stream binario download).
- **Paginazione**: **nessuna paginazione in v1**. Utente singolo, scala personale (decine/centinaia di task per progetto). Tutti gli endpoint di lista (`list_tasks`, `GET /projects/:id/board`, `GET /board`, `list_comments`, `list_attachments`) restituiscono l'intero result set. Se in futuro la scala cresce, si introdurrà `?cursor=&limit=` senza rompere la forma della risposta (i risultati resteranno sotto una chiave `items`/array diretto — vedi nota per singolo endpoint).

---

## 1. Formato errori condiviso REST/MCP

Tutte le risposte di errore REST usano lo stesso envelope JSON:

```json
{
  "error": {
    "code": "DEPENDENCY_BLOCKED",
    "message": "Task bloccato da 2 task non completati: Setup DB, Setup Auth"
  }
}
```

Tool MCP: in caso di errore, il tool **non lancia un'eccezione di trasporto silenziosa** ma restituisce un risultato con `isError: true` e lo stesso `code`/`message` serializzati in `content[0].text` come JSON:

```json
{
  "isError": true,
  "content": [
    { "type": "text", "text": "{\"error\":{\"code\":\"DEPENDENCY_BLOCKED\",\"message\":\"Task bloccato da 2 task non completati: Setup DB, Setup Auth\"}}" }
  ]
}
```

Questo garantisce che un agente AI possa leggere `code`/`message` in modo deterministico dal testo, senza dipendere da un'eccezione di protocollo JSON-RPC generica.

### Codici di errore condivisi

| code | REST HTTP status | Significato |
|---|---|---|
| `UNAUTHORIZED` | 401 | JWT mancante/scaduto/non valido (REST) |
| `MCP_TOKEN_INVALID` | 401 | Token MCP mancante, non valido o revocato |
| `FORBIDDEN` | 403 | Risorsa esiste ma fuori scope (es. task di altro progetto con token MCP) |
| `NOT_FOUND` | 404 | Entità non trovata |
| `VALIDATION_ERROR` | 400 | Body/query non validi (zod) |
| `DEPENDENCY_BLOCKED` | 409 | Tentativo di move a `in_progress` con dipendenze non `done` |
| `CIRCULAR_DEPENDENCY` | 409 | Dipendenza creerebbe un ciclo (diretto o indiretto) |
| `INVALID_STATUS_TRANSITION` | 409 | Riservato per usi futuri — **v1 non lo emette**: tutte le transizioni `draft ↔ todo ↔ in_progress ↔ testing ↔ done` sono ammesse in entrambe le direzioni (si può riaprire un task tornando da `done` a `in_progress`), l'unico vincolo è `DEPENDENCY_BLOCKED` per entrare in `in_progress` |
| `ATTACHMENT_TOO_LARGE` | 413 | File > 20MB |
| `ATTACHMENT_TYPE_NOT_ALLOWED` | 415 | Tipo file non ammesso |
| `CONFLICT` | 409 | Altri conflitti generici (es. nome progetto duplicato, se applicabile) |
| `EMAIL_SEND_FAILED` | 502 | Il server SMTP ha rifiutato/non ha completato l'invio (solo `POST /settings/email/test`) |
| `INTERNAL_ERROR` | 500 | Errore non gestito |

`message` è sempre una stringa human-readable in italiano (coerente col resto del codebase), pensata per essere mostrata sia in UI sia restituita a un agente AI via MCP.

Mapping MCP: i tool non restituiscono HTTP status; usano sempre lo stesso `code` nel JSON di errore, indipendentemente dal transport (stdio/HTTP MCP).

---

## 1b. Schema URL del frontend

Il frontend (SPA) espone URL stabili e condivisibili; il server deve servire `index.html` per qualsiasi path non-`/api` (nginx `try_files`, Vite dev, Cloudflare Pages).

| URL | Vista |
|---|---|
| `/projects/all` | Board aggregata |
| `/projects/:projectId` | Board del progetto |
| `/projects/:projectId/stats` | Statistiche del progetto (non esistono per `all`) |
| `/activity` | Log attività |
| `/profile` | Profilo utente |
| `<qualsiasi vista>?task=:taskId` | Apre il drawer del task sopra la vista corrente |

Filtri della board nel query string (opzionali, combinabili): `assignedToMe=1`, `assignee=<userId\|__unassigned__>`, `priority=low,high`, `blocked=1`, `q=<testo>`, `tag=<tag>`, `subtasks=1`, `projects=<id,id>` (solo `/projects/all`). I filtri restano attivi cambiando progetto.

Path sconosciuti o progetti non accessibili/archiviati → redirect al primo progetto (altrimenti `/projects/all`) con avviso. Un `?task=` inesistente o non accessibile (`GET /tasks/:taskId` → 403/404) viene rimosso con avviso. Le email di notifica e il tool MCP `get_task` (campo `url`), se `appUrl` è configurato (Impostazioni → Notifiche email), linkano `${appUrl}/projects/:projectId?task=:taskId`.

---

## 2. Autenticazione

### REST — JWT
- Header: `Authorization: Bearer <jwt>`
- Tutte le route tranne `POST /auth/login` richiedono JWT valido (`app.authenticate` su Fastify, middleware Hono sul Worker).
- Claim: `{ sub: userId, email }`. Scadenza 30gg. Ruolo e progetti associati **non** sono nel JWT: vengono riletti dal DB ad ogni richiesta, così un cambio di ruolo/assegnazioni è immediato.
- Ruoli: `admin` (accesso a tutti i progetti, gestione utenti e impostazioni globali) e `manager` (accesso solo ai progetti in `UserProject`). Il primo utente creato al bootstrap è sempre `admin`.
- Errore: token mancante/non valido/scaduto → `401 { error: { code: "UNAUTHORIZED", message: "..." } }`; accesso a una risorsa di un progetto non assegnato → `403 FORBIDDEN`.

`POST /auth/login`
- Body: `{ "email": string, "password": string }`
- 200: `{ "token": "<jwt>", "user": { "id", "email", "firstName", "lastName", "role": "admin"|"manager", "projectIds": [] } }`
- 401 `UNAUTHORIZED` con credenziali non valide.

`GET /auth/me`
- Auth: JWT
- 200: `{ "id", "email", "firstName", "lastName", "role", "projectIds" }` — usato dalla UI per aggiornare ruolo e permessi senza nuovo login.

`PATCH /auth/me`
- Auth: JWT
- Body: `{ "email": string, "firstName"?: string, "lastName"?: string }` — modifica self-service di nome, cognome ed email. L'email è anche l'identificativo di login. Non cambia password, ruolo o progetti; l'email deve essere valida e non già usata da un altro utente.
- 200: utente aggiornato nella stessa forma di `GET /auth/me`; 400 `VALIDATION_ERROR` se l'email non è valida; 409 `CONFLICT` se è già in uso.

`PATCH /auth/me/password`
- Auth: JWT
- Body: `{ "currentPassword": string, "newPassword": string (min 8) }` — cambio password self-service; la password attuale viene verificata e la nuova deve essere diversa.
- 200: `{ "ok": true }`; 400 `VALIDATION_ERROR` se la password attuale non è corretta, se la nuova è troppo corta o coincide con quella attuale.

### Gestione utenti (solo `admin`)
`GET /users`
- 200: lista di `{ id, email, firstName, lastName, role, createdAt, projectIds, projects: [{ id, name }] }` (nessun hash password).

`POST /users`
- Body: `{ "email": string, "password": string (min 8), "firstName"?: string, "lastName"?: string, "role": "admin"|"manager", "projectIds"?: string[] }`
- Un `manager` deve avere almeno un progetto; per un `admin` `projectIds` è ignorato (accesso implicito a tutti).
- 201: utente creato; 400 `VALIDATION_ERROR`; 409 `CONFLICT` se l'email esiste.

`PATCH /users/:userId`
- Body: `{ "role"?: "admin"|"manager", "password"?: string, "email"?: string, "firstName"?: string, "lastName"?: string, "projectIds"?: string[] }`
- Cambiare `role`/`projectIds` aggiorna subito i permessi dell'utente. Non è possibile rimuovere l'ultimo admin né il ruolo admin al proprio utente.
- 200: utente aggiornato.

`DELETE /users/:userId`
- 200: `{ id, deleted: true }`. Non è possibile eliminare se stessi o l'ultimo admin. Le associazioni `UserProject` vengono rimosse in cascade; i progetti restano.

### Scoping dei progetti
- `GET /projects` restituisce tutti i progetti per l'admin, solo quelli assegnati per il manager.
- Tutte le route project-scoped (`/projects/:projectId/*`, `/tasks/:taskId/*`, `/attachments/:attachmentId/*`, `/board`) verificano l'accesso al progetto della risorsa; per il manager `/board` è limitata ai progetti assegnati.

### Assegnatario e owner dei task
- Ogni task ha un assegnatario opzionale (`assigneeId`, `assigneeName`) e un owner (`ownerId`, `ownerName`) = utente che lo ha creato via REST (`null` se creato via MCP o prima dell'introduzione del campo; backfill dall'evento `task.created`).
- Non limitano la visibilità: chi accede al progetto vede tutti i task. Servono come filtri (`assigneeId`, `ownerId` su liste e board; in UI il filtro "Assegnati a me").
- Assegnatari ammessi: tutti gli admin e i manager associati al progetto (altrimenti 400 `VALIDATION_ERROR`). `assigneeId: null` toglie l'assegnatario.
- L'owner non è modificabile. Cancellare un utente lascia i suoi task senza assegnatario/owner.

### `GET /projects/:projectId/assignees`
- Auth: JWT, accesso al progetto
- 200: `[{ id, email, name }]` — admin e manager del progetto (`name` = nome e cognome, oppure email)
- `POST /projects`, `GET/PUT /settings/storage`, `/settings/email*`, `POST /admin/run-standup` e `/users*` sono riservate agli admin.

### MCP — token di progetto
- stdio: `MCP_PROJECT_TOKEN` da env.
- HTTP: header `Authorization: Bearer <token>` su `POST /mcp`.
- Il token in chiaro esiste **solo al momento della creazione** (risposta di `POST /projects/:id/tokens`); da lì in poi solo l'hash è persistito (`ProjectToken.tokenHash`, bcrypt — vedi `mcp/auth.ts` esistente).
- Token invalido o revocato → stesso errore per entrambi i transport: `MCP_TOKEN_INVALID`.
  - REST HTTP transport (`POST /mcp`): risposta `401 { "error": { "code": "MCP_TOKEN_INVALID", "message": "Token MCP non valido o revocato" } }`.
  - stdio transport: processo termina con `console.error` + `process.exit(1)` riportando lo stesso messaggio (nessuna risposta JSON-RPC possibile prima della connessione).
- Ogni tool verifica che le entità coinvolte (task, commento, allegato) appartengano al `projectId` risolto dal token; in caso contrario → `FORBIDDEN` ("... non appartiene al progetto del token").

---

## 3. REST — Progetti (B6)

### `GET /projects`
- Auth: JWT
- Query: `?includeArchived=true|false` (default `false`)
- 200:
```json
[{ "id": "...", "name": "...", "archived": false, "createdAt": "2026-09-15T10:00:00.000Z" }]
```

### `POST /projects`
- Auth: JWT
- Body: `{ "name": string (1..200 char) }`
- 201: `Project`
- 400 `VALIDATION_ERROR` se `name` mancante/vuoto

### `PATCH /projects/:projectId`
- Auth: JWT
- Body: `{ "name"?: string }` (rinomina; unico campo modificabile oltre archive)
- 200: `Project` aggiornato
- 404 `NOT_FOUND`

### `POST /projects/:projectId/archive`
- Auth: JWT
- Body: nessuno
- 200: `Project` con `archived: true`
- Non cancella task/token associati
- 404 `NOT_FOUND`

### `POST /projects/:projectId/unarchive`
- Auth: JWT
- Body: nessuno
- 200: `Project` con `archived: false`
- 404 `NOT_FOUND`
- **Decisione confermata:** l'archiviazione è reversibile in v1, per evitare che un errore diventi irreversibile senza intervenire sul DB.

### Token MCP (B12) — sotto `/projects/:projectId/tokens`

`POST /projects/:projectId/tokens`
- Auth: JWT
- Body: `{}` (nessun parametro; opzionale `{ "label"?: string }` per riconoscerlo in UI)
- 201:
```json
{ "id": "...", "projectId": "...", "label": "...", "token": "raw-token-shown-once", "createdAt": "..." }
```
  `token` è l'unico momento in cui il valore in chiaro è esposto.

`GET /projects/:projectId/tokens`
- Auth: JWT
- 200: lista di `{ id, projectId, label, createdAt, revokedAt }` — **mai** `tokenHash` né il valore in chiaro.

`DELETE /projects/:projectId/tokens/:tokenId` (revoca)
- Auth: JWT
- 200: `{ id, revokedAt }`
- 404 `NOT_FOUND` se token non esiste o non appartiene al progetto

---

## 4. REST — Task, Dipendenze, Commenti (B7)

### `GET /projects/:projectId/tasks`
- Auth: JWT
- Query: `status?`, `priority?`, `tag?` (singolo tag), `search?` (case-insensitive su titolo+descrizione), `assigneeId?`, `ownerId?`
- 200: `Task[]`

### `GET /tasks/:taskId`
- Auth: JWT
- 200: `Task` esteso con `blockedBy: TaskDependency[]`, `blocking: TaskDependency[]`, `commentsCount`, `attachmentsCount`, `subtaskCount`, `openSubtaskCount`, `subtaskStatusCounts: { draft, todo, in_progress, testing, done }`, `subtasks: { id, title, status }[]` (0/`[]` se il task non ha sotto-task)
- 404 `NOT_FOUND`

### `POST /projects/:projectId/tasks`
- Body:
```json
{
  "title": "string (required, 1..300)",
  "description": "string (markdown, default \"\")",
  "type": "bug|feature|analysis (default feature)",
  "priority": "low|medium|high|urgent (default medium)",
  "complexity": "1|2|3|5|8|13|21|null",
  "tags": ["string"],
  "dueDate": "ISO8601|null",
  "parentId": "string|null",
  "assigneeId": "string|null (default null)"
}
```
- 201: `Task`
- 400 `VALIDATION_ERROR` se `complexity` non è un valore Fibonacci ammesso, o se `parentId` punta a un task che è già esso stesso una sotto-task (un solo livello di annidamento)
- 404 `NOT_FOUND` se `parentId` non esiste o appartiene a un altro progetto

### `POST /tasks/:taskId/subtasks`
- Crea in blocco più sotto-task di `taskId` in un'unica chiamata (tutto o niente: se una riga non è valida non viene creato nulla)
- Body: `{ "subtasks": [{ "title": "...", "description"?, "type"?, "priority"?, "complexity"?, "tags"?, "dueDate"?, "assigneeId"? }] }` (almeno 1 elemento)
- 201: `Task[]` (le sotto-task create, tutte con `parentId = taskId`)
- 400 `VALIDATION_ERROR`, 404 `NOT_FOUND` (parent inesistente)

### `PATCH /tasks/:taskId`
- Body: qualunque sottoinsieme dei campi di create eccetto `status` (che passa da `move`, vedi sotto), incluso `parentId` per riassegnare/staccare (`null`) la sotto-task
- 200: `Task`
- 404 `NOT_FOUND`
- 400 `VALIDATION_ERROR` se `parentId` creerebbe un annidamento a più livelli, un self-parenting, o se il task ha già proprie sotto-task (non può diventare a sua volta una sotto-task)

### `POST /tasks/:taskId/move`
- Body: `{ "status": "draft"|"todo"|"in_progress"|"testing"|"done", "position"?: number }`
- `position` opzionale: indice manuale nella colonna target (drag&drop); se omesso, il task va in coda alla colonna.
- 200: `Task` aggiornato
- 409 `DEPENDENCY_BLOCKED` se `status === "in_progress"` e ci sono dipendenze non `done`:
```json
{ "error": { "code": "DEPENDENCY_BLOCKED", "message": "Task bloccato da 2 task non completati: Setup DB, Setup Auth" } }
```
- 404 `NOT_FOUND`

Nota: l'attuale `PATCH /tasks/:taskId/status` in `routes/board.ts` va rinominato/esteso a `POST /tasks/:taskId/move` per includere `position` e restituire l'envelope errore standard (attualmente restituisce `{ error: string }` grezzo — da allineare).

### `DELETE /tasks/:taskId`
- 200: `{ "id": "...", "deleted": true }`
- Cascade: elimina commenti, allegati (incl. file fisico/oggetto S3 tramite `AttachmentStorage.delete`), e tutte le `TaskDependency` che coinvolgono il task (come `taskId` o `blockedByTaskId`).
- 400 `VALIDATION_ERROR` se il task ha ancora sotto-task: vanno eliminate o riassegnate (`parentId: null`) prima di eliminare il parent — nessun cascade automatico sulle sotto-task, per non perderle per errore.
- 404 `NOT_FOUND`

### Dipendenze

`POST /tasks/:taskId/dependencies`
- Body: `{ "blockedByTaskId": "string" }`
- 201: `TaskDependency`
- 409 `CIRCULAR_DEPENDENCY` se creerebbe un ciclo diretto o indiretto (verifica via visita del grafo, non solo il caso diretto attualmente implementato in `taskService.addDependency` — **gap**, vedi §6)
- 400 `VALIDATION_ERROR` se `taskId === blockedByTaskId`

`DELETE /tasks/:taskId/dependencies/:blockedByTaskId`
- 200: `{ deleted: true }`
- 404 se la dipendenza non esiste

`GET /tasks/:taskId/blockers`
- 200: `{ "blockers": Task[], "allResolved": boolean }` — lista dei task che bloccano `taskId`, con flag di comodo.

### Commenti

`POST /tasks/:taskId/comments`
- Body: `{ "body": "string markdown" }`
- 201: `Comment`

`GET /tasks/:taskId/comments`
- 200: `Comment[]` ordinati per `createdAt asc` (cronologico)

---

## 5. REST — Board (B8)

### `GET /projects/:projectId/board`
- Auth: JWT
- Query: `priority?`, `tag?`, `search?`, `assigneeId?`, `ownerId?`
- 200:
```json
{
  "draft": [Task],
  "todo": [Task],
  "in_progress": [Task],
  "testing": [Task],
  "done": [Task]
}
```
Ogni `Task` include `blockedByOpenCount` (numero di dipendenze non-done, per il badge di blocco in UI).

### `GET /board` (aggregata, solo REST/UI — mai MCP)
- Auth: JWT
- Query: `projectIds?` (CSV, se omesso = tutti i progetti non archiviati), `priority?`, `tag?`, `search?`, `assigneeId?`, `ownerId?`
- 200: stessa forma di sopra, con in più `projectId`/`projectName` su ogni card:
```json
{ "draft": [{ "...task", "projectId": "...", "projectName": "..." }], "todo": [...], "in_progress": [...], "testing": [...], "done": [...] }
```

### `GET /projects/:projectId/stats` (solo REST/UI — non esposto via MCP)
- Auth: JWT, con lo stesso controllo di accesso al progetto della board
- Query: `type?`, `priority?`, `assigneeId?` (`none` = non assegnati), `tag?`, `includeSubtasks?` (`true`/`false`, default `false`), `from?` (ISO, default: 30 giorni fa)
- 200: `ProjectStats` (vedi `packages/core`). Descrive lo stato attuale dei task che passano i filtri. `availableTags`/`availableAssignees` sono calcolati su tutti i task del progetto. `closedInPeriod` conta i task attualmente `done` con un evento `task.status_changed` → `done` successivo a `from`:
```json
{
  "total": 4, "open": 3, "done": 1, "blocked": 0, "overdue": 0,
  "complexityTotal": 8, "complexityDone": 3,
  "closedInPeriod": 1, "periodFrom": "2026-09-21T00:00:00.000Z",
  "byStatus": { "draft": 2, "todo": 0, "in_progress": 1, "testing": 0, "done": 1 },
  "byStatusPriority": { "draft": { "low": 0, "medium": 0, "high": 1, "urgent": 1 }, "...": {} },
  "byStatusType": { "draft": { "bug": 1, "feature": 1, "analysis": 0 }, "...": {} },
  "byAssignee": [{ "assigneeId": null, "name": null, "byStatus": { "draft": 2, "...": 0 }, "open": 3 }],
  "availableTags": ["api", "ui"],
  "availableAssignees": [{ "id": "...", "name": "Ada Dev" }]
}
```

---

## 6. REST — Allegati (B11)

### `POST /tasks/:taskId/attachments`
- Auth: JWT
- `multipart/form-data`, campo file `file`
- Validazioni: dimensione ≤ 20MB, MIME/estensione in whitelist (immagini: png/jpg/jpeg/gif/webp; PDF; Office: doc/docx/xls/xlsx/ppt/pptx; testo/markdown: txt/md; zip). Eseguibili/script sempre rifiutati anche se rinominati (check MIME reale, non solo estensione).
- 201: `Attachment` (senza contenuto binario, solo metadati)
- 413 `ATTACHMENT_TOO_LARGE`
- 415 `ATTACHMENT_TYPE_NOT_ALLOWED`

### `GET /tasks/:taskId/attachments`
- 200: `Attachment[]`

### `GET /attachments/:attachmentId/download`
- 200: stream binario, `Content-Disposition: attachment; filename="..."`, `Content-Type` da `mimeType`
- Delega a `AttachmentStorage.getUrl`/stream secondo backend configurato (local: file diretto; s3: redirect a URL firmato o proxy — implementazione in B9/B10)
- 404 `NOT_FOUND`

### `DELETE /attachments/:attachmentId`
- 200: `{ deleted: true }` — rimuove anche l'oggetto fisico via `AttachmentStorage.delete`

---

## 6bis. REST — Impostazioni storage globali

Config persistita in `StorageSettings` (singleton, id `"singleton"`), sostituisce/ha priorità sulle variabili d'ambiente `ATTACHMENTS_BACKEND`/`S3_*` una volta impostata da UI. Vedi `apps/server/src/lib/attachmentStorage/index.ts`.

### `GET /settings/storage`
- Auth: JWT (qualsiasi utente autenticato)
- 200: `StorageSettings` — `{ backend: "local"|"s3", localDir, s3Endpoint, s3Bucket, s3Region, s3AccessKeyId, s3SecretAccessKeySet, updatedAt }`. Il secret S3 non è mai restituito in chiaro, solo il flag `s3SecretAccessKeySet`.

### `PUT /settings/storage`
- Auth: JWT
- Body: `{ backend: "local"|"s3", localDir?, s3Endpoint?, s3Bucket?, s3Region?, s3AccessKeyId?, s3SecretAccessKey? }`
- `s3SecretAccessKey` omesso/vuoto → mantiene il secret già salvato (evita di dover ripresentare il secret ad ogni save dal form).
- `backend: "s3"` richiede `s3Bucket` non vuoto, altrimenti 400 `VALIDATION_ERROR`.
- 200: `StorageSettings` aggiornato.
- Unica opzione "S3-compatibile" in UI: copre sia MinIO self-hosted (valorizzando `s3Endpoint`) sia servizi online come AWS S3 (endpoint vuoto).

---

## 6ter. REST — Notifiche in-app

Notifiche locali basate su un event log append-only (`TaskEvent`) e su un cursore di lettura unico per utente (`NotificationState.lastSeenEventId`). Vedi `apps/server/src/services/notificationService.ts`.

- Nessun fan-out: una riga di evento per azione, con al massimo un destinatario (`TaskEvent.recipientId`) deciso quando l'evento viene scritto.
- **Destinatario = l'assegnatario del task**, solo se esiste e non è lui l'autore dell'azione (nessuno riceve notifiche delle proprie azioni; le azioni via MCP notificano l'assegnatario). Admin e altri membri non ricevono notifiche: vedono tutto nel log attività.
  - `task.created`: all'assegnatario indicato alla creazione.
  - `task.assigned`: al nuovo assegnatario quando un task viene assegnato/riassegnato (nessuno se l'assegnatario viene tolto).
  - `task.status_changed`: all'assegnatario se lo stato lo cambia qualcun altro.
  - `comment.created`: all'assegnatario se commenta qualcun altro.
- Permessi di progetto applicati in lettura: un manager tolto dal progetto non vede più le notifiche relative. Gli eventi scritti prima di `recipientId` non generano notifiche.
- Eventi emessi dal service layer, quindi coprono REST Node, REST Cloudflare e MCP allo stesso modo. `TaskEvent` registra tutte le mutazioni dei task (log attività, §6quater); le notifiche e le email considerano solo `NOTIFICATION_EVENT_TYPES` (`@my-planner/core`).
- **Nessun tool MCP per le notifiche**: sono una vista per utente, il token MCP è di progetto.

### `GET /notifications?limit=30`
- Auth: JWT (qualsiasi utente autenticato)
- Restituisce gli eventi con `id > lastSeenEventId` destinati all'utente (`recipientId`), di progetti accessibili (admin: tutti; manager: assegnati) e non archiviati.
- 200: `{ items: NotificationItem[], unreadCount, lastSeenEventId, serverCursor }`
  - `NotificationItem`: `{ id, type: "task.created"|"task.status_changed"|"task.assigned"|"comment.created", projectId, projectName, taskId, taskTitle, actorId, actorName, actorType: "user"|"mcp"|"system", from, to, excerpt, createdAt }`
  - `taskTitle`/`excerpt` sono denormalizzati nell'evento: la notifica resta leggibile anche se il task non esiste più.
  - `serverCursor` è il max id visibile, da passare al mark-as-read.
  - Il cursore viene inizializzato alla creazione dell'utente (e, per utenti storici, alla prima lettura): nessun backlog di eventi precedenti.

### `POST /notifications/read`
- Auth: JWT
- Body: `{ upTo: number }` (tipicamente il `serverCursor` appena ricevuto)
- Sposta il cursore a `min(upTo, ultimo evento visibile)` — non può "leggere in anticipo" eventi non ancora restituiti.
- 200: `{ lastSeenEventId }`

### Email di notifica (SMTP)
Stessi eventi della campanella, inviati via SMTP se configurato da `/settings/email` (vedi `apps/server/src/services/emailNotificationService.ts`).
- Destinatario = lo stesso della notifica in-app (l'assegnatario, mai l'autore), solo se ha ancora accesso al progetto; progetti archiviati esclusi. Un messaggio per evento.
- **Mai bloccante**: senza config (nessuna riga, `enabled: false`, campi mancanti, password non decifrabile) non parte nulla; l'invio gira in background dopo la risposta (Worker: `ctx.waitUntil`), quindi errori SMTP o timeout (30s) vengono solo loggati e non toccano né la mutazione né l'evento in-app.

### `GET /settings/email` (admin)
- 200: `EmailSettings` — `{ enabled, configured, host, port, security: "tls"|"starttls"|"none", username, passwordSet, fromAddress, fromName, appUrl, updatedAt }`. La password non è mai restituita, solo `passwordSet`. `configured` = abilitata e completa (le email partono solo in quel caso). Senza riga salvata restituisce i default (`enabled: false`).

### `PUT /settings/email` (admin)
- Body: `{ enabled: boolean, host?, port: 1..65535, security, username?, password?, fromAddress?, fromName?, appUrl? }`
- `password` omessa/vuota → mantiene quella salvata; `username` vuoto → la password viene rimossa.
- La password è salvata cifrata (AES-256-GCM, chiave HKDF da `SETTINGS_ENCRYPTION_KEY`, fallback `JWT_SECRET`). Cambiando chiave la password va reinserita.
- 400 `VALIDATION_ERROR`: `enabled: true` senza `host`/`fromAddress`/password (se c'è `username`); credenziali con `security: "none"`; `fromAddress`/`host`/`appUrl` non validi.
- 200: `EmailSettings` aggiornato.

### `POST /settings/email/test` (admin)
- Body: `{ to?: string }` (default: email dell'admin che chiama).
- Usa la config **salvata**, anche se non ancora abilitata.
- 200: `{ ok: true, to }` · 400 `VALIDATION_ERROR` se la config è incompleta · 502 `EMAIL_SEND_FAILED` con il messaggio SMTP.

## 6quater. REST — Log attività

Stessa tabella `TaskEvent` delle notifiche, esposta per intero (incluse le azioni dell'utente corrente). Vedi `apps/server/src/services/activityService.ts`.

Tipi evento (`TASK_EVENT_TYPES`): `task.created`, `task.updated`, `task.status_changed`, `task.assigned`, `task.deleted`, `comment.created`, `dependency.added`, `dependency.removed`, `attachment.added`, `attachment.deleted`.
- `task.updated` è emesso solo se almeno un campo cambia davvero (diff prima/dopo); `changes: [{ field, from, to }]` con `field` ∈ `title|description|type|priority|complexity|tags|dueDate|parentId`. Per `description` i valori non vengono salvati (`from`/`to` null). Valori troncati a 200 caratteri. Il cambio di assegnatario è l'evento `task.assigned` con `assigneeName` (null = assegnatario tolto).
- `dependency.*` è registrato sul task bloccato, con `relatedTaskId`/`relatedTaskTitle` del task che blocca.
- `attachment.*` riporta `fileName`.
- Riordino nella stessa colonna e `add_dependency` idempotente su dipendenza già esistente non generano eventi.

"Tempo reale" = polling con `afterId` (UI: 5s sulla pagina log, 10s nel drawer, solo con tab visibile). Niente SSE/WebSocket per lo stesso motivo delle notifiche (Workers/D1).

### `GET /activity`
- Auth: JWT (qualsiasi utente autenticato)
- Visibilità: admin tutti i progetti, manager solo quelli assegnati (archiviati inclusi). Un `projectId` non accessibile restituisce lista vuota, non 403. Il filtro `taskId` funziona anche su task eliminati.
- Query (tutti opzionali): `projectId`, `taskId`, `types` (CSV di tipi evento), `actor` (id utente, oppure `mcp` / `system`), `from`/`to` (ISO, estremi inclusivi su `createdAt`), `search` (testo su titolo task/estratto/nome file denormalizzati, max 200), `afterId` (solo eventi più nuovi), `beforeId` (solo più vecchi, per paginare), `limit` (1..200, default 50).
- 200: `{ items: ActivityLogItem[], hasMore }`, ordinati per `id` decrescente.
  - `ActivityLogItem` = `NotificationItem` + `{ changes, relatedTaskId, relatedTaskTitle, fileName, assigneeName }`.
- 400 `VALIDATION_ERROR` su tipi sconosciuti o date non valide.

### `GET /activity/actors`
- Auth: JWT
- 200: `[{ id, name }]` per il filtro autore: admin vede tutti gli utenti, manager gli admin e i manager che condividono almeno un suo progetto.
- **Nessun tool MCP** per il log (vista per utente).

---

## 7. Tool MCP (B14/B15)

Tutti i tool sono registrati da `createProjectMcpServer(projectId)` e operano **esclusivamente** sul `projectId` risolto dal token. Nessun parametro `projectId` in input (implicito). Ogni tool richiama le stesse funzioni di `apps/server/src/services/*` usate da REST.

Convenzione di output: ogni tool ritorna `{ content: [{ type: "text", text: JSON.stringify(risultato) }] }` in caso di successo; in caso di errore `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] }` (vedi §1).

### Progetti
**Decisione confermata:** `list_projects`, `create_project`, `update_project`, `archive_project`/`unarchive_project` **non sono esposti via MCP**. Il token è scoped a un solo progetto già esistente: creare/elencare/archiviare progetti non ha una semantica sensata in quello scope ed è comunque un'operazione di gestione, non di lavoro quotidiano sui task — resta **solo UI/JWT** (REST, §5-6), come già deciso per `get_aggregated_board`. Il set MCP v1 copre solo Task/Dipendenze/Commenti/Allegati/Board (sotto).

### Task

**`list_tasks`**
- Input: `{ status: z.enum(["draft","todo","in_progress","testing","done"]).optional(), priority: z.enum(["low","medium","high","urgent"]).optional(), tag: z.string().optional(), search: z.string().optional(), assigneeId: z.string().optional(), ownerId: z.string().optional() }`
- Output: `Task[]`

**`list_assignees`**
- Input: `{}`
- Output: `[{ id, email, name }]` — utenti assegnabili ai task del progetto (admin e membri), da usare come `assigneeId`

**`get_task`**
- Input: `{ taskId: z.string() }`
- Output: `Task` esteso (blockedBy, blocking, commentsCount, attachmentsCount, `subtaskCount`, `openSubtaskCount`, `subtaskStatusCounts`, `subtasks: { id, title, status }[]`) — cosi' un agente MCP distingue un task singolo (`subtaskCount: 0`) da uno con un gruppo di sotto-task senza dover interpretare testo libero
- Errori: `NOT_FOUND`, `FORBIDDEN` (task di altro progetto)

**`create_task`**
- Input:
```ts
z.object({
  title: z.string().min(1).max(300),
  description: z.string().default(""),
  type: z.enum(["bug","feature","analysis"]).default("feature"),
  priority: z.enum(["low","medium","high","urgent"]).default("medium"),
  complexity: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(5),z.literal(8),z.literal(13),z.literal(21)]).nullable().optional(),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
})
```
- `assigneeId`: admin o manager del progetto (vedi `list_assignees`); omesso = non assegnato. I task creati via MCP hanno `ownerId: null`
- `parentId` crea direttamente una sotto-task di un task esistente (che non deve essere a sua volta una sotto-task: un solo livello di annidamento)
- Output: `Task`
- Errori: `VALIDATION_ERROR`, `NOT_FOUND` (`parentId` inesistente/altro progetto)

**`create_subtasks`**
- Input: `{ parentId: z.string(), subtasks: z.array({ title, description?, type?, priority?, complexity?, tags?, dueDate? }).min(1) }`
- Crea in blocco un gruppo di sotto-task sotto `parentId` in un'unica chiamata — pensato per scomporre un task grande (es. 13 elementi) senza 13 chiamate separate a `create_task`. Tutto o niente.
- Output: `Task[]`
- Errori: `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`

**`update_task`**
- Input: come `create_task` ma tutti i campi `.optional()` (no default) + `taskId: z.string()` obbligatorio; niente `status`
- `parentId: null` stacca la sotto-task e la rende di nuovo un task di primo livello
- Output: `Task`
- Errori: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR` (annidamento >1 livello, self-parenting, o il task ha già proprie sotto-task)

**`delete_task`**
- Input: `{ taskId: z.string() }`
- Output: `{ id: string, deleted: true }`
- Errori: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR` (ha ancora sotto-task: eliminale o riassegnale prima)

**`move_task`**
- Input: `{ taskId: z.string(), status: z.enum(["draft","todo","in_progress","testing","done"]), position: z.number().int().nonnegative().optional() }`
- Output: `Task`
- Errori: `DEPENDENCY_BLOCKED` (con `message` che elenca i blocker non risolti, identico a REST), `NOT_FOUND`, `FORBIDDEN`

### Dipendenze

**`add_dependency`**
- Input: `{ taskId: z.string(), blockedByTaskId: z.string() }`
- Output: `TaskDependency`
- Errori: `CIRCULAR_DEPENDENCY`, `VALIDATION_ERROR` (self-dependency), `FORBIDDEN`

**`remove_dependency`**
- Input: `{ taskId: z.string(), blockedByTaskId: z.string() }`
- Output: `{ deleted: true }`
- Errori: `NOT_FOUND`

**`list_blockers`**
- Input: `{ taskId: z.string() }`
- Output: `{ blockers: Task[], allResolved: boolean }`

### Commenti

**`add_comment`**
- Input: `{ taskId: z.string(), body: z.string().min(1) }`
- Output: `Comment`

**`list_comments`**
- Input: `{ taskId: z.string() }`
- Output: `Comment[]` (ordine cronologico crescente)

### Allegati

**`list_attachments`**
- Input: `{ taskId: z.string() }`
- Output: `Attachment[]`

**`attach_file`**
- Input: `{ taskId: z.string(), fileName: z.string(), mimeType: z.string(), contentBase64: z.string() }`
  (via MCP il file arriva come base64 inline — non c'è multipart; il limite 20MB si applica al contenuto decodificato)
- Output: `Attachment`
- Errori: `ATTACHMENT_TOO_LARGE`, `ATTACHMENT_TYPE_NOT_ALLOWED`

**`get_attachment_url`**
- Input: `{ attachmentId: z.string() }`
- Output: `{ url: string, expiresAt: string | null }`
- **Decisione confermata:** il download via MCP si autentica con lo **stesso token MCP** del progetto, nessun sistema di auth aggiuntivo. Per backend `local`, `url` punta a `GET /mcp/attachments/:attachmentId/download` (route dedicata, separata da `GET /attachments/:attachmentId/download` che richiede JWT) e accetta `Authorization: Bearer <project-token>`; `expiresAt: null`. Per backend `s3`, URL firmato temporaneo generato dal backend storage, con `expiresAt` valorizzato.

### Board

**`get_board`**
- Input: `{ priority: z.enum([...]).optional(), tag: z.string().optional(), search: z.string().optional() }`
- Output: `{ draft: Task[], todo: Task[], in_progress: Task[], testing: Task[], done: Task[] }` — scoped al progetto del token. Ogni `Task` include `subtaskCount`/`openSubtaskCount`/`subtaskStatusCounts` (0 se non ha sotto-task); la board resta piatta (non filtra le sotto-task fuori dalle colonne, quello e' un accorpamento lato frontend, vedi BACKLOG.md).
- **Nessun `get_aggregated_board` via MCP** (per costruzione: il token è scoped a un progetto).

---

## 8. Modifiche allo schema Prisma

Applicate direttamente in `apps/server/prisma/schema.prisma`:

1. `ProjectToken.label` (String?, opzionale) — per permettere di distinguere più token dello stesso progetto in UI (creato ma non richiesto esplicitamente dal PRD; nome descrittivo mostrato in `GET /projects/:id/tokens`).
2. Nessun campo per il token in chiaro va persistito: **confermato** design esistente (`tokenHash` unico, mai il raw token salvato — corretto, nessuna modifica necessaria oltre `label`).
3. `Task.position` già presente — sufficiente per drag&drop manuale (nessuna modifica).
4. Indice esplicito per la ricerca full-text case-insensitive titolo+descrizione: SQLite + Prisma non hanno FTS nativo abilitato di default in questo schema; v1 userà `contains` case-insensitive lato Prisma (SQLite `LIKE` è case-insensitive per ASCII by default, sufficiente per v1). Nessuna modifica di schema necessaria; annotato qui per `coder`/`dev-ops` come nota implementativa, non un gap di schema.

5. `StorageSettings` (nuovo modello, singleton) — persiste la configurazione del servizio di storage allegati scelta da UI (filesystem locale o S3-compatibile/MinIO), vedi §6bis.

6. `TaskEvent` + `NotificationState` (nuovi modelli) — notifiche in-app (§6ter). `TaskEvent.id` è `Int @default(autoincrement())` e funge da cursore monotono; `actorId` è nullable (MCP/sistema) con `onDelete: SetNull`; `taskId` è uno scalare senza relation, così l'evento sopravvive alla delete del task (il titolo è denormalizzato in `data`). Migrazioni: `prisma/migrations/20261019140000_add_notifications` (Node/SQLite) e `apps/server/migrations/0006_add_notifications.sql` (D1).

7. Indice `TaskEvent(taskId, id)` per il log attività per task (§6quater). Migrazioni: `prisma/migrations/20261019200000_task_event_task_index` e `apps/server/migrations/0008_add_task_event_task_index.sql`.

Vedi diff applicato in coda al file schema.

---

## 9. Decisioni chiuse (ex domande aperte)

Tutti i punti sollevati in fase di revisione sono stati decisi dall'utente e recepiti nel contratto sopra:

1. **Tool progetto via MCP** → rimossi (`list_projects`/`create_project`/`update_project`/`archive_project`/`unarchive_project` restano solo REST/UI, §6).
2. **Transizioni di stato** → libere in entrambe le direzioni; unico vincolo è `DEPENDENCY_BLOCKED` per entrare in `in_progress` (§1, §7).
3. **Download allegati via MCP** → autenticato con lo stesso token MCP del progetto, via route dedicata `GET /mcp/attachments/:attachmentId/download` (§7).
4. **Ricerca full-text a scala futura** → `LIKE` case-insensitive su SQLite confermato sufficiente per v1, nessuna azione richiesta (§8, nota implementativa).
5. **Unarchive progetto** → aggiunto `POST /projects/:projectId/unarchive` (§6).
