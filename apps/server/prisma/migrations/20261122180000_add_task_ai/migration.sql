-- Gestione AI del task (passi triage/coder/reviewer, modalita di avviso).
-- Colonne con default: i task esistenti restano non AI.
ALTER TABLE "Task" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "aiSteps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Task" ADD COLUMN "aiNotify" TEXT NOT NULL DEFAULT 'end';
ALTER TABLE "Task" ADD COLUMN "aiWatcherId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_aiEnabled_idx" ON "Task"("aiEnabled");
