-- Esecuzione dei passi AI (blocco, rimandi, fallimento). Colonne con default/nullable.
ALTER TABLE "Task" ADD COLUMN "aiRunStep" TEXT;
ALTER TABLE "Task" ADD COLUMN "aiRunStartedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "aiRejectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "aiFailedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "aiFailReason" TEXT;
ALTER TABLE "Project" ADD COLUMN "repoUrl" TEXT;
