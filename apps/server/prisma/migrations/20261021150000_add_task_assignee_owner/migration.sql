-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "type" TEXT NOT NULL DEFAULT 'feature',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "complexity" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '',
    "dueDate" DATETIME,
    "position" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "ownerId" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("complexity", "createdAt", "description", "dueDate", "id", "parentId", "position", "priority", "projectId", "status", "tags", "title", "type", "updatedAt") SELECT "complexity", "createdAt", "description", "dueDate", "id", "parentId", "position", "priority", "projectId", "status", "tags", "title", "type", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Backfill owner: autore dell evento task.created, se e ancora un utente.
UPDATE "Task" SET "ownerId" = (
    SELECT e."actorId" FROM "TaskEvent" e
    JOIN "User" u ON u."id" = e."actorId"
    WHERE e."taskId" = "Task"."id" AND e."type" = 'task.created'
    ORDER BY e."id" LIMIT 1
) WHERE "ownerId" IS NULL;

