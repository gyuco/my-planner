import { z } from "zod";
import { AI_NOTIFY_MODES, AI_STEPS, TASK_EVENT_TYPES } from "@my-planner/core";

/**
 * Schemi zod condivisi tra le route REST, allineati agli enum e ai formati
 * gia' validati dai tool MCP (vedi mcp/server.ts) cosi' che REST e MCP
 * restituiscano lo stesso VALIDATION_ERROR sugli stessi input malformati.
 */

/**
 * Stato di un task: uno dei 5 stati di base o uno stato personalizzato del
 * progetto (chiave o etichetta). La validita' rispetto al progetto e' decisa
 * dal service (statusService.resolveStatus), uguale per REST e MCP.
 */
export const taskStatusSchema = z.string().trim().min(1).max(60);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const taskTypeSchema = z.enum(["bug", "feature", "analysis"]);

export const complexitySchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13), z.literal(21)])
  .nullable()
  .optional();

export const taskFiltersQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  assigneeId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
});

export const boardFiltersQuerySchema = z.object({
  priority: taskPrioritySchema.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  assigneeId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  /** "false": la board non carica i task completati (vedi GET /tasks/done). */
  includeDone: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});

/** Filtri di GET /tasks/done (archivio dei completati, a pagine). */
export const doneTasksQuerySchema = z.object({
  projectIds: z.string().optional(),
  search: z.string().max(200).optional(),
  q: z.string().max(200).optional(),
  tag: z.string().max(100).optional(),
  assigneeId: z.string().min(1).optional(),
  priorities: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(taskPrioritySchema).optional()),
  includeSubtasks: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(0).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const aggregatedBoardQuerySchema = boardFiltersQuerySchema.extend({
  projectIds: z.string().optional(),
});

/** Filtri di GET /projects/:projectId/stats (vedi services/statsService.ts). */
export const projectStatsQuerySchema = z.object({
  type: taskTypeSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  includeSubtasks: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  from: z.coerce.date().optional(),
});

export const taskInputSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  type: taskTypeSchema.optional(),
  priority: taskPrioritySchema.optional(),
  complexity: complexitySchema,
  tags: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: z.string().nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

export const taskUpdateInputSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  type: taskTypeSchema.optional(),
  priority: taskPrioritySchema.optional(),
  complexity: complexitySchema,
  tags: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: z.string().nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
});

export const createSubtasksInputSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        description: z.string().optional(),
        type: taskTypeSchema.optional(),
        priority: taskPrioritySchema.optional(),
        complexity: complexitySchema,
        tags: z.array(z.string()).optional(),
        dueDate: z.string().datetime().nullable().optional(),
        assigneeId: z.string().min(1).nullable().optional(),
      })
    )
    .min(1),
});

export const moveTaskInputSchema = z.object({
  status: taskStatusSchema,
  position: z.number().int().nonnegative().optional(),
});

/** Creazione / rinomina di uno stato personalizzato di progetto. */
export const projectStatusInputSchema = z.object({
  label: z.string().trim().min(1).max(50),
});

export const dependencyInputSchema = z.object({
  blockedByTaskId: z.string().min(1),
});

export const commentInputSchema = z.object({
  body: z.string().min(1),
});

/** "Devolver a En curso": il motivo diventa un commento (stessa regola). */
export const sendBackTaskInputSchema = z.object({
  message: z.string().min(1),
});

/** Gestione AI del task (solo admin): con enabled true serve almeno un passo. */
export const taskAiInputSchema = z
  .object({
    enabled: z.boolean(),
    steps: z.array(z.enum(AI_STEPS)).max(AI_STEPS.length).optional(),
    notify: z.enum(AI_NOTIFY_MODES).optional(),
  })
  .refine((v) => !v.enabled || (v.steps?.length ?? 0) > 0, {
    message: "Scegli almeno un passo AI (triage, coder, reviewer)",
    path: ["steps"],
  });

/** Registrazione di un dispositivo per le notifiche push (PushSubscription del browser). */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  locale: z.string().max(10).optional(),
  label: z.string().max(100).nullable().optional(),
});

/** Routine Claude Code del progetto per l'avvio automatico dei passi AI (solo admin). */
export const aiRoutineInputSchema = z.object({
  routineId: z.string().min(1).max(100),
  token: z.string().max(500).nullable().optional(),
});

/** Sessione interattiva di Claude Code avviata con la routine del progetto (solo admin). */
export const aiRoutineSessionInputSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  taskId: z.string().min(1).optional(),
});

/** Polling delle notifiche: limite massimo per non trascinare troppo payload. */
export const notificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * Filtri del log attivita' (GET /activity). `types` e' CSV; `actor` e'
 * "mcp", "system" oppure l'id di un utente. `from`/`to` accettano ISO date o
 * datetime.
 */
export const activityQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(TASK_EVENT_TYPES)).optional()),
  actor: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  afterId: z.coerce.number().int().nonnegative().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Mark-as-read a cursore unico: `upTo` e' il `serverCursor` ricevuto dal GET. */
export const markNotificationsReadInputSchema = z.object({
  upTo: z.number().int().nonnegative(),
});

export const projectNameInputSchema = z.object({
  name: z.string().min(1).max(200),
});

/**
 * PATCH /projects/:projectId: nome e/o repository GitHub (null o "" lo
 * toglie). Il repository si normalizza in https://github.com/owner/repo.
 */
export const projectUpdateInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    repoUrl: z.string().max(300).nullable().optional(),
    groupName: z.string().max(60).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.repoUrl !== undefined || v.groupName !== undefined, {
    message: "Nessun campo da aggiornare",
  });

export const projectTokenInputSchema = z.object({
  label: z.string().optional(),
});

export const userRoleSchema = z.enum(["admin", "manager"]);

export const createUserInputSchema = z.object({
  email: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  role: userRoleSchema,
  projectIds: z.array(z.string().min(1)).optional(),
});

export const updateUserInputSchema = z.object({
  role: userRoleSchema.optional(),
  password: z.string().min(8).max(200).optional(),
  email: z.string().trim().min(1).max(200).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  projectIds: z.array(z.string().min(1)).optional(),
});

/**
 * Dati modificabili dall'utente sul proprio profilo. L'email e' anche
 * l'identificativo di login, quindi il cambio e' immediato dalla pagina profilo.
 */
export const updateProfileInputSchema = z.object({
  email: z.string().trim().min(1).max(200),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

/** Upload avatar: data URL base64 (formato e dimensione verificati nel service). */
export const avatarInputSchema = z.object({
  dataUrl: z.string().min(1).max(300_000),
});

/** Cambio password self-service: la password attuale serve come conferma. */
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const storageSettingsInputSchema = z.object({
  backend: z.enum(["local", "s3"]),
  localDir: z.string().min(1).optional(),
  s3Endpoint: z.string().optional().nullable(),
  s3Bucket: z.string().optional().nullable(),
  s3Region: z.string().optional().nullable(),
  s3AccessKeyId: z.string().optional().nullable(),
  // Vuota/omessa = non cambiare il secret gia' salvato (evita di dover
  // ripresentare il secret ad ogni salvataggio dal form frontend).
  s3SecretAccessKey: z.string().optional().nullable(),
});

export const emailSettingsInputSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255).optional().nullable(),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls", "none"]),
  username: z.string().trim().max(255).optional().nullable(),
  // Vuota/omessa = mantiene la password gia' salvata (come s3SecretAccessKey).
  password: z.string().max(500).optional().nullable(),
  fromAddress: z.string().trim().max(255).optional().nullable(),
  fromName: z.string().trim().max(100).optional(),
  appUrl: z.string().trim().max(500).optional().nullable(),
});

export const emailTestInputSchema = z.object({
  to: z.string().trim().max(255).optional(),
});

export const voiceSettingsInputSchema = z.object({
  enabled: z.boolean(),
  // Vuota/omessa = mantiene la chiave gia' salvata; removeApiKey la cancella.
  apiKey: z.string().trim().max(500).optional().nullable(),
  removeApiKey: z.boolean().optional(),
  model: z.string().trim().max(100).optional(),
  voiceName: z.string().trim().max(50).optional().nullable(),
  // Pre-triage (stessa chiave): omessi = invariati; modello vuoto = default.
  pretriageEnabled: z.boolean().optional(),
  pretriageModel: z.string().trim().max(100).optional(),
});
