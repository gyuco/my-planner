-- Migration D1 #1: schema finale my-planner (porting CF2).
-- D1 e' un DB SQLite fresco: a differenza delle migrazioni Prisma (che
-- giocano su PRAGMA/redefine per un DB gia' esistente), qui creiamo lo
-- schema finale in una migrazione unica. Aggiornato al 2026-09-15:
-- senza parentTaskId (feature subtask rimossa), con size su Attachment e
-- con la tabella StorageSettings.

-- Utente unico (bootstrap da env BOOTSTRAP_USERNAME/BOOTSTRAP_PASSWORD)
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Progetti
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Token MCP per progetto (hash -> projectId)
CREATE TABLE "ProjectToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ProjectToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "ProjectToken_tokenHash_key" ON "ProjectToken"("tokenHash");

-- Task (stato draft|in_progress|done, priorita' low|medium|high|urgent)
CREATE TABLE "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "complexity" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '',
    "dueDate" DATETIME,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE
);

-- Dipendenze tra task (blocco)
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "blockedByTaskId" TEXT NOT NULL,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE,
    CONSTRAINT "TaskDependency_blockedByTaskId_fkey" FOREIGN KEY ("blockedByTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "TaskDependency_taskId_blockedByTaskId_key" ON "TaskDependency"("taskId", "blockedByTaskId");

-- Commenti sui task
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE
);

-- Allegati (storageRef punta alla chiave R2 / path locale)
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "storageBackend" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE
);

-- Singleton config storage (mantenuto per compatibilita' d'API, sul porting
-- Cloudflare il backend e' sempre R2 / ATTACHMENTS_BACKEND=r2)
CREATE TABLE "StorageSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "backend" TEXT NOT NULL DEFAULT 'local',
    "localDir" TEXT NOT NULL DEFAULT './attachments/local',
    "s3Endpoint" TEXT,
    "s3Bucket" TEXT,
    "s3Region" TEXT,
    "s3AccessKeyId" TEXT,
    "s3SecretAccessKey" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);