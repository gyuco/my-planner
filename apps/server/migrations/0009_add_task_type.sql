-- Migration D1 #9: tipo di ticket (bug | feature | analysis).
--
-- Colonna con default: le righe esistenti diventano "feature".

ALTER TABLE "Task" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'feature';
