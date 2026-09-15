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
| `INVALID_STATUS_TRANSITION` | 409 | Riservato per usi futuri — **v1 non lo emette**: tutte le transizioni `draft ↔ in_progress ↔ done` sono ammesse in entrambe le direzioni (si può riaprire un task tornando da `done` a `in_progress`), l'unico vincolo è `DEPENDENCY_BLOCKED` per entrare in `in_progress` |
| `ATTACHMENT_TOO_LARGE` | 413 | File > 20MB |
| `ATTACHMENT_TYPE_NOT_ALLOWED` | 415 | Tipo file non ammesso |
| `CONFLICT` | 409 | Altri conflitti generici (es. nome progetto duplicato, se applicabile) |
| `INTERNAL_ERROR` | 500 | Errore non gestito |

`message` è sempre una stringa human-readable in italiano (coerente col resto del codebase), pensata per essere mostrata sia in UI sia restituita a un agente AI via MCP.

Mapping MCP: i tool non restituiscono HTTP status; usano sempre lo stesso `code` nel JSON di errore, indipendentemente dal transport (stdio/HTTP MCP).

---

## 2. Autenticazione

### REST — JWT
- Header: `Authorization: Bearer <jwt>`
- Tutte le route tranne `POST /auth/login` richiedono JWT valido (già implementato in `index.ts` via `app.authenticate`).
- Claim: `{ sub: userId, username }`. Scadenza 30gg (`expiresIn: "30d"` da impostare in `app.jwt.sign`, attualmente mancante nel codice esistente — **gap da correggere in B4**: `routes/auth.ts` firma il JWT senza `expiresIn`).
- Errore: token mancante/non valido/scaduto → `401 { error: { code: "UNAUTHORIZED", message: "..." } }`.

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
- Query: `status?`, `priority?`, `tag?` (singolo tag), `search?` (case-insensitive su titolo+descrizione)
- 200: `Task[]`

### `GET /tasks/:taskId`
- Auth: JWT
- 200: `Task` esteso con `blockedBy: TaskDependency[]`, `blocking: TaskDependency[]`, `commentsCount`, `attachmentsCount`
- 404 `NOT_FOUND`

### `POST /projects/:projectId/tasks`
- Body:
```json
{
  "title": "string (required, 1..300)",
  "description": "string (markdown, default \"\")",
  "priority": "low|medium|high|urgent (default medium)",
  "complexity": "1|2|3|5|8|13|21|null",
  "tags": ["string"],
  "dueDate": "ISO8601|null"
}
```
- 201: `Task`
- 400 `VALIDATION_ERROR` se `complexity` non è un valore Fibonacci ammesso

### `PATCH /tasks/:taskId`
- Body: qualunque sottoinsieme dei campi di create eccetto `status` (che passa da `move`, vedi sotto)
- 200: `Task`
- 404 `NOT_FOUND`

### `POST /tasks/:taskId/move`
- Body: `{ "status": "draft"|"in_progress"|"done", "position"?: number }`
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
- Query: `priority?`, `tag?`, `search?`
- 200:
```json
{
  "draft": [Task],
  "in_progress": [Task],
  "done": [Task]
}
```
Ogni `Task` include `blockedByOpenCount` (numero di dipendenze non-done, per il badge di blocco in UI).

### `GET /board` (aggregata, solo REST/UI — mai MCP)
- Auth: JWT
- Query: `projectIds?` (CSV, se omesso = tutti i progetti non archiviati), `priority?`, `tag?`, `search?`
- 200: stessa forma di sopra, con in più `projectId`/`projectName` su ogni card:
```json
{ "draft": [{ "...task", "projectId": "...", "projectName": "..." }], "in_progress": [...], "done": [...] }
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

## 7. Tool MCP (B14/B15)

Tutti i tool sono registrati da `createProjectMcpServer(projectId)` e operano **esclusivamente** sul `projectId` risolto dal token. Nessun parametro `projectId` in input (implicito). Ogni tool richiama le stesse funzioni di `apps/server/src/services/*` usate da REST.

Convenzione di output: ogni tool ritorna `{ content: [{ type: "text", text: JSON.stringify(risultato) }] }` in caso di successo; in caso di errore `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] }` (vedi §1).

### Progetti
**Decisione confermata:** `list_projects`, `create_project`, `update_project`, `archive_project`/`unarchive_project` **non sono esposti via MCP**. Il token è scoped a un solo progetto già esistente: creare/elencare/archiviare progetti non ha una semantica sensata in quello scope ed è comunque un'operazione di gestione, non di lavoro quotidiano sui task — resta **solo UI/JWT** (REST, §5-6), come già deciso per `get_aggregated_board`. Il set MCP v1 copre solo Task/Dipendenze/Commenti/Allegati/Board (sotto).

### Task

**`list_tasks`**
- Input: `{ status: z.enum(["draft","in_progress","done"]).optional(), priority: z.enum(["low","medium","high","urgent"]).optional(), tag: z.string().optional(), search: z.string().optional() }`
- Output: `Task[]`

**`get_task`**
- Input: `{ taskId: z.string() }`
- Output: `Task` esteso (blockedBy, blocking, commentsCount, attachmentsCount)
- Errori: `NOT_FOUND`, `FORBIDDEN` (task di altro progetto)

**`create_task`**
- Input:
```ts
z.object({
  title: z.string().min(1).max(300),
  description: z.string().default(""),
  priority: z.enum(["low","medium","high","urgent"]).default("medium"),
  complexity: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(5),z.literal(8),z.literal(13),z.literal(21)]).nullable().optional(),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().datetime().nullable().optional(),
})
```
- Output: `Task`
- Errori: `VALIDATION_ERROR`

**`update_task`**
- Input: come `create_task` ma tutti i campi `.optional()` (no default) + `taskId: z.string()` obbligatorio; niente `status`
- Output: `Task`
- Errori: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`

**`delete_task`**
- Input: `{ taskId: z.string() }`
- Output: `{ id: string, deleted: true }`
- Errori: `NOT_FOUND`, `FORBIDDEN`

**`move_task`**
- Input: `{ taskId: z.string(), status: z.enum(["draft","in_progress","done"]), position: z.number().int().nonnegative().optional() }`
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
- Output: `{ draft: Task[], in_progress: Task[], done: Task[] }` — scoped al progetto del token.
- **Nessun `get_aggregated_board` via MCP** (per costruzione: il token è scoped a un progetto).

---

## 8. Modifiche allo schema Prisma

Applicate direttamente in `apps/server/prisma/schema.prisma`:

1. `ProjectToken.label` (String?, opzionale) — per permettere di distinguere più token dello stesso progetto in UI (creato ma non richiesto esplicitamente dal PRD; nome descrittivo mostrato in `GET /projects/:id/tokens`).
2. Nessun campo per il token in chiaro va persistito: **confermato** design esistente (`tokenHash` unico, mai il raw token salvato — corretto, nessuna modifica necessaria oltre `label`).
3. `Task.position` già presente — sufficiente per drag&drop manuale (nessuna modifica).
4. Indice esplicito per la ricerca full-text case-insensitive titolo+descrizione: SQLite + Prisma non hanno FTS nativo abilitato di default in questo schema; v1 userà `contains` case-insensitive lato Prisma (SQLite `LIKE` è case-insensitive per ASCII by default, sufficiente per v1). Nessuna modifica di schema necessaria; annotato qui per `coder`/`dev-ops` come nota implementativa, non un gap di schema.

5. `StorageSettings` (nuovo modello, singleton) — persiste la configurazione del servizio di storage allegati scelta da UI (filesystem locale o S3-compatibile/MinIO), vedi §6bis.

Vedi diff applicato in coda al file schema.

---

## 9. Decisioni chiuse (ex domande aperte)

Tutti i punti sollevati in fase di revisione sono stati decisi dall'utente e recepiti nel contratto sopra:

1. **Tool progetto via MCP** → rimossi (`list_projects`/`create_project`/`update_project`/`archive_project`/`unarchive_project` restano solo REST/UI, §6).
2. **Transizioni di stato** → libere in entrambe le direzioni; unico vincolo è `DEPENDENCY_BLOCKED` per entrare in `in_progress` (§1, §7).
3. **Download allegati via MCP** → autenticato con lo stesso token MCP del progetto, via route dedicata `GET /mcp/attachments/:attachmentId/download` (§7).
4. **Ricerca full-text a scala futura** → `LIKE` case-insensitive su SQLite confermato sufficiente per v1, nessuna azione richiesta (§8, nota implementativa).
5. **Unarchive progetto** → aggiunto `POST /projects/:projectId/unarchive` (§6).
