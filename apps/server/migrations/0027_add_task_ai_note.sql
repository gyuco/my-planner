-- Migration D1 #26: nota libera dell'admin per l'agente AI del task (null =
-- nessuna nota). Stessa modifica della migrazione Prisma
-- 20261127150000_add_task_ai_note.
ALTER TABLE "Task" ADD COLUMN "aiNote" TEXT;
