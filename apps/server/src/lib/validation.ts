import { z } from "zod";

/**
 * Schemi zod condivisi tra le route REST, allineati agli enum e ai formati
 * gia' validati dai tool MCP (vedi mcp/server.ts) cosi' che REST e MCP
 * restituiscano lo stesso VALIDATION_ERROR sugli stessi input malformati.
 */

export const taskStatusSchema = z.enum(["draft", "in_progress", "done"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const complexitySchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13), z.literal(21)])
  .nullable()
  .optional();

export const taskFiltersQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
});

export const boardFiltersQuerySchema = z.object({
  priority: taskPrioritySchema.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
});

export const aggregatedBoardQuerySchema = boardFiltersQuerySchema.extend({
  projectIds: z.string().optional(),
});

export const taskInputSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  complexity: complexitySchema,
  tags: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const taskUpdateInputSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  complexity: complexitySchema,
  tags: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const createSubtasksInputSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        description: z.string().optional(),
        priority: taskPrioritySchema.optional(),
        complexity: complexitySchema,
        tags: z.array(z.string()).optional(),
        dueDate: z.string().datetime().nullable().optional(),
      })
    )
    .min(1),
});

export const moveTaskInputSchema = z.object({
  status: taskStatusSchema,
  position: z.number().int().nonnegative().optional(),
});

export const dependencyInputSchema = z.object({
  blockedByTaskId: z.string().min(1),
});

export const commentInputSchema = z.object({
  body: z.string().min(1),
});

export const projectNameInputSchema = z.object({
  name: z.string().min(1).max(200),
});

export const projectTokenInputSchema = z.object({
  label: z.string().optional(),
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
