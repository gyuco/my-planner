-- Migration D1 #21: agente Claude Managed Agents per la chat.
-- Stessa modifica della migrazione Prisma 20261123120000_add_agent_chat.
ALTER TABLE "Project" ADD COLUMN "agentApiKeyEncrypted" TEXT;
ALTER TABLE "Project" ADD COLUMN "agentGithubTokenEncrypted" TEXT;
ALTER TABLE "Project" ADD COLUMN "agentId" TEXT;
ALTER TABLE "Project" ADD COLUMN "agentEnvironmentId" TEXT;
ALTER TABLE "Project" ADD COLUMN "agentVaultId" TEXT;
ALTER TABLE "Project" ADD COLUMN "agentMcpTokenId" TEXT;
ALTER TABLE "Project" ADD COLUMN "agentBudgetCents" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Project" ADD COLUMN "agentLastError" TEXT;

CREATE TABLE "AgentChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentChat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentChat_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentChat_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentChat_sessionId_key" ON "AgentChat"("sessionId");
CREATE INDEX "AgentChat_projectId_taskId_idx" ON "AgentChat"("projectId", "taskId");
