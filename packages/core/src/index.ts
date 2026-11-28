/**
 * Stati di base di un task, nell'ordine in cui compaiono come colonne sulla
 * board: draft -> todo -> in_progress -> testing -> done. Esistono in ogni
 * progetto e non si possono rinominare ne' cancellare.
 */
export const TASK_STATUSES = ["draft", "todo", "in_progress", "testing", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Valore di `Task.status`: uno stato di base oppure la chiave di uno stato
 * personalizzato del progetto (vedi `ProjectStatus`).
 */
export type TaskStatusKey = TaskStatus | (string & {});

export function isBaseStatus(status: string): status is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(status);
}

/**
 * Stato di un progetto (GET /projects/:projectId/statuses). Gli stati di base
 * hanno `builtIn: true` e `label` uguale alla chiave (la UI li traduce); quelli
 * personalizzati hanno una chiave stabile generata alla creazione (rinominare
 * cambia solo `label`, quindi i task e i client MCP non si rompono).
 */
export interface ProjectStatus {
  key: TaskStatusKey;
  label: string;
  builtIn: boolean;
}

/** Formato della chiave di uno stato personalizzato. */
export const CUSTOM_STATUS_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Chiave derivata dall'etichetta di uno stato personalizzato:
 * "Pendiente email" -> "pendiente-email". Stringa vuota se non resta nulla.
 */
export function statusKeyFromLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40)
    .replace(/[-_]+$/g, "");
}

/**
 * Ordine delle colonne: gli stati personalizzati stanno tra in_progress e
 * testing (sono stati "aperti" in attesa di qualcosa, es. bloqueante).
 */
export function orderedStatusKeys(customKeys: readonly string[]): TaskStatusKey[] {
  return ["draft", "todo", "in_progress", ...customKeys, "testing", "done"];
}

export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** Tipo di ticket: bug, nuova funzionalita' o analisi. Default "feature". */
export const TASK_TYPES = ["bug", "feature", "analysis"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const FIBONACCI_COMPLEXITY = [1, 2, 3, 5, 8, 13, 21] as const;
export type TaskComplexity = (typeof FIBONACCI_COMPLEXITY)[number];

/** Ruolo applicativo: l'admin accede a tutto, il manager solo ai progetti assegnati. */
export type UserRole = "admin" | "manager";

/** Utente di base (senza relazioni). Per la UI di gestione vedi `UserAccount`. */
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;
}

/**
 * Utente autenticato restituito da login/`GET /auth/me`. `projectIds` e'
 * sempre vuoto per gli admin, che hanno accesso implicito a tutti i progetti.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  projectIds: string[];
  /**
   * Versione dell'avatar caricato (ms epoch dell'ultimo upload), null se
   * l'utente non ne ha uno. L'immagine si legge da `GET /auth/me/avatar`.
   */
  avatarVersion: number | null;
}

/** Utente completo per la gestione admin (nessun hash password esposto). */
export interface UserAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;
  projectIds: string[];
  projects: Array<{ id: string; name: string }>;
}

/** Utente assegnabile a un task (GET /projects/:projectId/assignees). */
export interface TaskAssignee {
  id: string;
  email: string;
  /** Nome e cognome, oppure l'email se non compilati. */
  name: string;
}

export interface Project {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  /** Repository GitHub (https://github.com/owner/repo) dove lavorano gli agenti AI. */
  repoUrl?: string | null;
  /** Gruppo (solo visuale): i progetti con lo stesso gruppo stanno insieme nella sidebar. */
  groupName?: string | null;
  /** true se e' configurata la routine Claude Code per l'avvio automatico dei passi AI. */
  aiRoutineConfigured?: boolean;
}

/** Configurazione della routine di un progetto (GET /projects/:id/ai-routine, solo admin). */
export interface AiRoutineConfig {
  configured: boolean;
  routineId: string | null;
  lastFiredAt: string | null;
  lastError: string | null;
  lastSessionUrl: string | null;
  /** Prompt da incollare nella routine. */
  prompt: string;
}

/** Esito di un avvio della routine (POST /projects/:id/ai-routine/run). */
export interface AiDispatchResult {
  fired: boolean;
  taskIds: string[];
  sessionUrl: string | null;
  reason: string | null;
}

/** Sessione interattiva di Claude Code avviata con la routine (POST /projects/:id/ai-routine/session). */
export interface AiRoutineSessionResult {
  /** Link alla sessione su claude.ai; null se la risposta della routine non lo riporta. */
  sessionUrl: string | null;
}

/** Riepilogo di una sotto-task, presente solo nell'array `subtasks` del dettaglio (GET /tasks/:taskId). */
export interface SubtaskSummary {
  id: string;
  title: string;
  status: TaskStatusKey;
}

/** Sotto-task per stato di base; `custom` conta quelle in stati personalizzati. */
export type SubtaskStatusCounts = Record<TaskStatus, number> & { custom: number };

export function emptySubtaskStatusCounts(): SubtaskStatusCounts {
  return { draft: 0, todo: 0, in_progress: 0, testing: 0, done: 0, custom: 0 };
}

/**
 * Stato suggerito per un parent in base alle sue sotto-task (lo stato del
 * parent resta manuale: questo valore serve solo a segnalare un
 * disallineamento). null se non ci sono sotto-task.
 * - tutte done -> done
 * - tutte in testing/done -> testing
 * - almeno una avviata (in_progress/testing/done o stato personalizzato) -> in_progress
 * - tutte draft -> draft
 * - altrimenti -> todo
 */
export function suggestParentStatus(counts: SubtaskStatusCounts): TaskStatus | null {
  const custom = counts.custom ?? 0;
  const total = TASK_STATUSES.reduce((sum, s) => sum + counts[s], 0) + custom;
  if (total === 0) return null;
  if (counts.done === total) return "done";
  if (counts.testing + counts.done === total) return "testing";
  if (counts.in_progress + counts.testing + counts.done + custom > 0) return "in_progress";
  if (counts.draft === total) return "draft";
  return "todo";
}

/**
 * Gestione AI di un task (solo admin). Ogni passo lavora su una colonna:
 * triage su `draft` (-> `todo`), coder su `todo` (-> `testing`), reviewer su
 * `testing` (-> `done`, oppure di nuovo `todo` se rimanda indietro). I passi
 * scelti sono un sottoinsieme qualunque, sempre in quest'ordine.
 */
export const AI_STEPS = ["triage", "coder", "reviewer"] as const;
export type AiStep = (typeof AI_STEPS)[number];

/** Avvisi al destinatario: alla fine del percorso, a ogni cambio di stato, mai. */
export const AI_NOTIFY_MODES = ["end", "each", "none"] as const;
export type AiNotifyMode = (typeof AI_NOTIFY_MODES)[number];

/** Colonna da cui parte ciascun passo AI. */
export const AI_STEP_STATUS: Record<AiStep, TaskStatusKey> = {
  triage: "draft",
  coder: "todo",
  reviewer: "testing",
};

/** Colonna in cui il task arriva quando il passo si chiude con successo. */
export const AI_STEP_TARGET: Record<AiStep, TaskStatusKey> = {
  triage: "todo",
  coder: "testing",
  reviewer: "done",
};

/** Un passo preso in carico da un agente scade dopo questo tempo (agente bloccato o caduto). */
export const AI_RUN_TTL_MS = 60 * 60 * 1000;

/** Rimandi del reviewer dopo i quali il percorso AI si ferma e avvisa. */
export const AI_MAX_REJECTS = 3;

/** Lunghezza massima della nota dell'admin per l'agente AI (TaskAi.note). */
export const AI_NOTE_MAX_LENGTH = 4000;

export interface TaskAi {
  enabled: boolean;
  /** Passi scelti, nell'ordine triage -> coder -> reviewer. */
  steps: AiStep[];
  notify: AiNotifyMode;
  /** Destinatario degli avvisi (l'admin che ha attivato la gestione AI). */
  watcherId: string | null;
  watcherName: string | null;
  /**
   * Nota libera dell'admin per l'agente (raccomandazioni, vincoli, contesto):
   * l'agente la legge prima di iniziare e la segue in tutti i passi. null se
   * assente. Conservata anche a gestione AI spenta.
   */
  note: string | null;
  /** Passo preso in carico da un agente (ai_start_step), se c'e'. */
  running?: { step: AiStep; startedAt: string } | null;
  /** Rimandi del reviewer nel giro corrente (al massimo AI_MAX_REJECTS). */
  rejectCount?: number;
  /** Percorso fermato (ai_fail o troppi rimandi): nessun passo in attesa finche' non si riprende. */
  failure?: { at: string; reason: string } | null;
  /** Ultimo avvio automatico (routine Claude Code): passo, quando, link alla sessione. */
  dispatch?: { step: AiStep | null; at: string; sessionUrl: string | null } | null;
}

/** Input di PUT /tasks/:taskId/ai (solo admin). */
export interface TaskAiInput {
  enabled: boolean;
  steps?: AiStep[];
  notify?: AiNotifyMode;
  /** Nota per l'agente (max AI_NOTE_MAX_LENGTH): stringa vuota/spazi o null = nessuna nota; omessa = invariata. */
  note?: string | null;
}

/**
 * Passo AI in attesa sul task: quello che parte dalla colonna in cui il task
 * si trova, se e' tra i passi scelti. null se la gestione AI e' spenta o se
 * nessun passo parte da quella colonna (es. `in_progress`, `done`).
 */
export function aiPendingStep(task: { status: string; ai?: TaskAi | null }, now = Date.now()): AiStep | null {
  if (!task.ai?.enabled || task.ai.failure) return null;
  if (aiRunningStep(task, now)) return null;
  return task.ai.steps.find((step) => AI_STEP_STATUS[step] === task.status) ?? null;
}

/** Passo in corso (preso in carico e non scaduto), se c'e'. */
export function aiRunningStep(task: { ai?: TaskAi | null }, now = Date.now()): AiStep | null {
  const running = task.ai?.enabled ? task.ai.running : null;
  if (!running) return null;
  return now - new Date(running.startedAt).getTime() < AI_RUN_TTL_MS ? running.step : null;
}

/** Normalizza un elenco di passi: solo valori validi, senza doppioni, in ordine canonico. */
export function normalizeAiSteps(steps: readonly string[]): AiStep[] {
  return AI_STEPS.filter((step) => steps.includes(step));
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatusKey;
  type: TaskType;
  priority: TaskPriority;
  complexity: TaskComplexity | null;
  tags: string[];
  dueDate: string | null;
  // Utente assegnatario (null se non assegnato). Nomi = nome e cognome,
  // oppure email.
  assigneeId: string | null;
  assigneeName: string | null;
  /** Versione dell'avatar dell'assegnatario (`GET /avatars/:userId`), null se assente. */
  assigneeAvatarVersion?: number | null;
  // Owner: chi ha creato il task (null se creato via MCP o prima del campo).
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  blockedByOpenCount?: number;
  // Sotto-task: un solo livello di annidamento (vedi API_CONTRACT.md §4/§7).
  // parentId presente solo se il task e' esso stesso una sotto-task.
  parentId?: string | null;
  // subtaskCount/openSubtaskCount presenti ovunque venga restituito un Task
  // (list/board/detail), sempre 0 se il task non ha sotto-task.
  subtaskCount?: number;
  openSubtaskCount?: number;
  // Ripartizione delle sotto-task per stato (tutti gli stati sempre presenti,
  // a 0 se vuoti): permette di mostrare l'avanzamento reale del parent.
  subtaskStatusCounts?: SubtaskStatusCounts;
  // Presenti solo su GET /tasks/:taskId (dettaglio esteso, vedi API_CONTRACT.md §4)
  blockedBy?: TaskDependency[];
  blocking?: TaskDependency[];
  commentsCount?: number;
  attachmentsCount?: number;
  subtasks?: SubtaskSummary[];
  /** Gestione AI: sempre presente nelle risposte del server (enabled false se spenta). */
  ai?: TaskAi;
}

export interface TaskDependency {
  taskId: string;
  blockedByTaskId: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  // "r2" è il backend del porting Cloudflare (CF7); resta compatibile con i
  // record storici "local"/"s3".
  storageBackend: "local" | "s3" | "r2";
  storageRef: string;
  createdAt: string;
}

export type StorageBackendType = "local" | "s3";

/**
 * Config globale del backend di storage allegati (vedi
 * apps/server/src/lib/attachmentStorage). Le credenziali S3 non vengono mai
 * restituite in chiaro dalla GET, solo un flag `s3SecretAccessKeySet`.
 */
export interface StorageSettings {
  backend: StorageBackendType;
  localDir: string;
  s3Endpoint: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKeySet: boolean;
  updatedAt: string;
}

export type EmailSecurity = "tls" | "starttls" | "none";

/**
 * Config SMTP globale per le email di notifica (GET/PUT /settings/email).
 * La password non viene mai restituita, solo il flag `passwordSet`.
 * `configured` = abilitata e completa: solo in quel caso partono email.
 */
export interface EmailSettings {
  enabled: boolean;
  configured: boolean;
  host: string | null;
  port: number;
  security: EmailSecurity;
  username: string | null;
  passwordSet: boolean;
  fromAddress: string | null;
  fromName: string;
  appUrl: string | null;
  updatedAt: string | null;
}

/** Modello Gemini Live usato di default dall'assistente vocale. */
export const DEFAULT_VOICE_MODEL = "gemini-3.8-live";

/**
 * Modello Gemini (testo) usato di default dal pre-triage dei task: alias
 * "latest" del Flash-Lite, incluso nel piano gratuito di Google AI Studio.
 */
export const DEFAULT_PRETRIAGE_MODEL = "gemini-flash-lite-latest";

/**
 * Config dell'assistente vocale Gemini Live (GET/PUT /settings/voice, solo
 * admin). La chiave API non viene mai restituita, solo il flag `apiKeySet`.
 * `configured` = abilitato e con chiave: solo allora gli utenti lo vedono.
 */
export interface VoiceSettings {
  enabled: boolean;
  configured: boolean;
  apiKeySet: boolean;
  model: string;
  /** Voce predefinita di Gemini (es. "Kore"); null = scelta del modello. */
  voiceName: string | null;
  /** Pre-triage dei task attivo (richiede solo la chiave, non l'assistente vocale). */
  pretriageEnabled: boolean;
  /** Modello Gemini di testo del pre-triage (es. "gemini-flash-lite-latest"). */
  pretriageModel: string;
  updatedAt: string | null;
}

/** Disponibilita' dell'assistente per l'utente corrente (GET /voice/status). */
export interface VoiceStatus {
  available: boolean;
}

/** Disponibilita' del pre-triage per l'utente corrente (GET /pretriage/status). */
export interface PretriageStatus {
  available: boolean;
}

/**
 * Esito strutturato del pre-triage (POST /tasks/:taskId/pretriage): JSON
 * prodotto da Gemini e ripulito dal server (duplicati solo tra i task aperti
 * del progetto, priorita'/complessita' solo valori ammessi).
 */
export interface PretriageResult {
  ready: boolean;
  missing: string[];
  ambiguities: string[];
  suggestedPriority: TaskPriority | null;
  suggestedComplexity: TaskComplexity | null;
  possibleDuplicates: { taskId: string; title: string }[];
  summary: string;
  /** Modello usato. */
  model: string;
}

/** Risposta di POST /tasks/:taskId/pretriage: esito + commento aggiunto al task. */
export interface PretriageResponse {
  result: PretriageResult;
  comment: Comment;
}

/**
 * Sessione vocale (POST /voice/session): token effimero monouso da usare
 * nel WebSocket Live al posto della chiave API, che resta sul server.
 */
export interface VoiceSession {
  token: string;
  /** URL WebSocket completo (token incluso). */
  wsUrl: string;
  model: string;
  voiceName: string | null;
  /** Oltre questo istante il token non apre piu' nuove sessioni. */
  expiresAt: string;
}

/**
 * Funzioni basate su Workers AI e Vectorize (GET /ai/features). Disponibili
 * solo sul Worker Cloudflare con i binding `AI` (e `VECTORIZE` per la ricerca
 * semantica); su Node/Docker sono tutte false e la UI nasconde i controlli.
 */
export interface AiFeatures {
  /** Ricerca semantica sui task e avviso di duplicati alla creazione. */
  semanticSearch: boolean;
  /** Trascrizione di note vocali (Whisper) salvate come commento. */
  voiceNotes: boolean;
  /** Riassunto in linguaggio naturale nello standup giornaliero. */
  standupSummary: boolean;
}

/** Task trovato dalla ricerca semantica, con il punteggio di somiglianza (0..1). */
export interface SemanticTaskMatch {
  taskId: string;
  projectId: string;
  title: string;
  status: TaskStatusKey;
  score: number;
}

/** Dispositivo registrato per le notifiche push (GET /auth/me/push-subscriptions). */
export interface PushDevice {
  id: string;
  label: string | null;
  locale: string;
  /** Host del push service (es. fcm.googleapis.com): indica il browser. */
  service: string;
  createdAt: string;
  lastSuccessAt: string | null;
}

/** Connector MCP globale dell'utente (/mcp/global), creato col login web OAuth. */
export interface UserMcpToken {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ProjectToken {
  id: string;
  projectId: string;
  tokenHash: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
}

/**
 * Tipi di evento del log attivita' (tabella TaskEvent, vedi
 * apps/server/src/services/activityService.ts). Solo un sottoinsieme genera
 * notifiche ed email: vedi `NOTIFICATION_EVENT_TYPES`.
 */
export const TASK_EVENT_TYPES = [
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.assigned",
  "task.deleted",
  "comment.created",
  "dependency.added",
  "dependency.removed",
  "attachment.added",
  "attachment.deleted",
  "ai.step_started",
  "ai.failed",
] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

/**
 * Eventi che possono generare una notifica in-app ed email. Il destinatario
 * e' solo l'assegnatario del task, e solo se l'azione e' di qualcun altro.
 */
export const NOTIFICATION_EVENT_TYPES = [
  "task.created",
  "task.status_changed",
  "task.assigned",
  "comment.created",
  "ai.failed",
] as const satisfies readonly TaskEventType[];

/** Campi del task tracciati da un evento `task.updated`. */
export type TaskTrackedField =
  | "title"
  | "description"
  | "type"
  | "priority"
  | "complexity"
  | "tags"
  | "dueDate"
  | "parentId"
  | "ai"
  | "aiNote";

/**
 * Singola modifica di un campo. Per `description` e `aiNote` (nota dell'admin
 * per l'agente) i valori non vengono salvati (testo potenzialmente lungo):
 * `from`/`to` sono sempre null. Il
 * cambio di assegnatario e' un evento a parte (`task.assigned`).
 */
export interface TaskFieldChange {
  field: TaskTrackedField;
  from: string | null;
  to: string | null;
}

/**
 * Notifica restituita da GET /notifications. `taskTitle` e `excerpt` sono
 * denormalizzati nell'evento, quindi restano leggibili anche dopo che il task
 * (o il commento) non esiste piu'.
 */
export interface NotificationItem {
  id: number;
  type: TaskEventType;
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskTitle: string;
  actorId: string | null;
  actorName: string | null;
  actorType: "user" | "mcp" | "system";
  from: TaskStatusKey | null;
  to: TaskStatusKey | null;
  excerpt: string | null;
  /** Passo AI coinvolto (`ai.*`). */
  aiStep?: AiStep | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
  lastSeenEventId: number;
  /** Max id visibile all'utente: da passare a POST /notifications/read. */
  serverCursor: number;
}

export interface MarkNotificationsReadResponse {
  lastSeenEventId: number;
}

/** Voce del log attivita' (GET /activity): una notifica con i dettagli extra. */
export interface ActivityLogItem extends NotificationItem {
  /** Solo per `task.updated`. */
  changes: TaskFieldChange[];
  /** Task collegato per `dependency.*` (il task che blocca). */
  relatedTaskId: string | null;
  relatedTaskTitle: string | null;
  /** Nome file per `attachment.*`. */
  fileName: string | null;
  /** Nuovo assegnatario per `task.assigned` (null = assegnatario rimosso). */
  assigneeName: string | null;
}

export interface ActivityLogResponse {
  /** Dal piu' recente al piu' vecchio. */
  items: ActivityLogItem[];
  /** True se esistono eventi piu' vecchi dell'ultimo restituito (paginazione con `beforeId`). */
  hasMore: boolean;
}

/** Autore che compare nel log, per popolare il filtro "autore". */
export interface ActivityActor {
  id: string;
  name: string;
}

/** Envelope condiviso per tutti gli errori REST e MCP (vedi API_CONTRACT.md §1). */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "MCP_TOKEN_INVALID"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DEPENDENCY_BLOCKED"
  | "CIRCULAR_DEPENDENCY"
  | "INVALID_STATUS_TRANSITION"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_TYPE_NOT_ALLOWED"
  | "CONFLICT"
  | "EMAIL_SEND_FAILED"
  | "VOICE_UNAVAILABLE"
  | "VOICE_PROVIDER_ERROR"
  | "PRETRIAGE_UNAVAILABLE"
  | "PRETRIAGE_QUOTA"
  | "PRETRIAGE_PROVIDER_ERROR"
  | "AI_UNAVAILABLE"
  | "AI_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export function apiError(code: ErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Eccezione tipizzata usata dal service layer condiviso (apps/server/src/services)
 * cosi' che REST e MCP possano mappare lo stesso envelope errore (vedi API_CONTRACT.md §1).
 */
export class ApiErrorException extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiErrorException";
    this.code = code;
  }

  toApiError(): ApiError {
    return apiError(this.code, this.message);
  }
}

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  MCP_TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  DEPENDENCY_BLOCKED: 409,
  CIRCULAR_DEPENDENCY: 409,
  INVALID_STATUS_TRANSITION: 409,
  ATTACHMENT_TOO_LARGE: 413,
  ATTACHMENT_TYPE_NOT_ALLOWED: 415,
  CONFLICT: 409,
  EMAIL_SEND_FAILED: 502,
  VOICE_UNAVAILABLE: 503,
  VOICE_PROVIDER_ERROR: 502,
  PRETRIAGE_UNAVAILABLE: 503,
  PRETRIAGE_QUOTA: 429,
  PRETRIAGE_PROVIDER_ERROR: 502,
  AI_UNAVAILABLE: 503,
  AI_PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/**
 * Board Kanban: una lista per stato. Oltre ai 5 stati di base contiene una
 * chiave per ogni stato personalizzato del progetto; le chiavi sono gia'
 * nell'ordine delle colonne (vedi `orderedStatusKeys`).
 */
export interface Board {
  draft: Task[];
  todo: Task[];
  in_progress: Task[];
  testing: Task[];
  done: Task[];
  [status: string]: Task[];
}

/** Riga del carico per assegnatario in `ProjectStats` (assigneeId null = non assegnati). */
export interface ProjectStatsAssignee {
  assigneeId: string | null;
  name: string | null;
  /** Stati di base sempre presenti; gli stati personalizzati solo se usati. */
  byStatus: Record<TaskStatusKey, number>;
  open: number;
}

/**
 * Statistiche di un progetto (GET /projects/:projectId/stats): fotografia
 * dello stato attuale dei task che soddisfano i filtri. Solo
 * `closedInPeriod` usa lo storico (eventi `task.status_changed` verso done).
 */
export interface ProjectStats {
  total: number;
  open: number;
  done: number;
  /** Task non done con almeno un bloccante non done. */
  blocked: number;
  /** Task non done con dueDate passata. */
  overdue: number;
  /** Somma della complessita' (task senza complessita' esclusi). */
  complexityTotal: number;
  complexityDone: number;
  /** Task attualmente done chiusi (ultimo passaggio a done) dopo `periodFrom`. */
  closedInPeriod: number;
  periodFrom: string;
  /** Stati di base sempre presenti; gli stati personalizzati solo se usati. */
  byStatus: Record<TaskStatusKey, number>;
  byStatusPriority: Record<TaskStatusKey, Record<TaskPriority, number>>;
  byStatusType: Record<TaskStatusKey, Record<TaskType, number>>;
  byAssignee: ProjectStatsAssignee[];
  /** Valori disponibili per i filtri, calcolati su tutti i task del progetto. */
  availableTags: string[];
  availableAssignees: Array<{ id: string; name: string }>;
}
