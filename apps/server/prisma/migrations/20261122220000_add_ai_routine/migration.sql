-- Avvio automatico dei passi AI (routine Claude Code). Solo colonne nullable.
ALTER TABLE "Project" ADD COLUMN "aiRoutineId" TEXT;
ALTER TABLE "Project" ADD COLUMN "aiRoutineTokenEncrypted" TEXT;
ALTER TABLE "Project" ADD COLUMN "aiRoutineLastFiredAt" DATETIME;
ALTER TABLE "Project" ADD COLUMN "aiRoutineLastError" TEXT;
ALTER TABLE "Project" ADD COLUMN "aiRoutineLastSessionUrl" TEXT;
ALTER TABLE "Task" ADD COLUMN "aiDispatchedStep" TEXT;
ALTER TABLE "Task" ADD COLUMN "aiDispatchedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "aiSessionUrl" TEXT;
