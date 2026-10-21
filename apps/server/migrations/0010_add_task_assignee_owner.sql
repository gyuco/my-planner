-- Migration D1 #10: assegnatario e owner (creatore) del task.
--
-- Colonne nullable: i task esistenti restano non assegnati; l'owner viene
-- ricostruito dall'evento task.created. Non limitano la visibilita'.

ALTER TABLE "Task" ADD COLUMN "assigneeId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "ownerId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");

-- Backfill owner: autore dell evento task.created, se e ancora un utente.
UPDATE "Task" SET "ownerId" = (
    SELECT e."actorId" FROM "TaskEvent" e
    JOIN "User" u ON u."id" = e."actorId"
    WHERE e."taskId" = "Task"."id" AND e."type" = 'task.created'
    ORDER BY e."id" LIMIT 1
) WHERE "ownerId" IS NULL;

