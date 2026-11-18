-- Migration D1 #13: stati personalizzati per progetto (es. "bloqueante").
--
-- Stessa modifica della migrazione Prisma 20261118120000_add_project_statuses.
-- Idempotente; i task esistenti non cambiano stato.
CREATE TABLE IF NOT EXISTS "ProjectStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectStatus_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectStatus_projectId_key_key" ON "ProjectStatus"("projectId", "key");
