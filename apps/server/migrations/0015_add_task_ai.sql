-- Migration D1 #15: gestione AI del task (passi triage/coder/reviewer,
-- modalita di avviso, admin destinatario). Stessa modifica della migrazione
-- Prisma 20261122180000_add_task_ai. I task esistenti restano non AI.
ALTER TABLE "Task" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "aiSteps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "aiNotify" TEXT NOT NULL DEFAULT 'end';
ALTER TABLE "Task" ADD COLUMN "aiWatcherId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_aiEnabled_idx" ON "Task"("aiEnabled");
