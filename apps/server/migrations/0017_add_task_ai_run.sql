-- Migration D1 #17: esecuzione dei passi AI (passo in corso, rimandi del
-- reviewer, fallimento). Stessa modifica della migrazione Prisma
-- 20261122210000_add_task_ai_run.
ALTER TABLE "Task" ADD COLUMN "aiRunStep" TEXT;
ALTER TABLE "Task" ADD COLUMN "aiRunStartedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "aiRejectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "aiFailedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "aiFailReason" TEXT;
ALTER TABLE "Project" ADD COLUMN "repoUrl" TEXT;
