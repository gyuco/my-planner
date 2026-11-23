-- Migration D1 #22: rimuove la chat con l'agente Claude Managed Agents.
-- Stessa modifica della migrazione Prisma 20261124120000_drop_agent_chat.
DROP INDEX IF EXISTS "AgentChat_projectId_taskId_idx";
DROP INDEX IF EXISTS "AgentChat_sessionId_key";
DROP TABLE IF EXISTS "AgentChat";

ALTER TABLE "Project" DROP COLUMN "agentApiKeyEncrypted";
ALTER TABLE "Project" DROP COLUMN "agentGithubTokenEncrypted";
ALTER TABLE "Project" DROP COLUMN "agentId";
ALTER TABLE "Project" DROP COLUMN "agentEnvironmentId";
ALTER TABLE "Project" DROP COLUMN "agentVaultId";
ALTER TABLE "Project" DROP COLUMN "agentMcpTokenId";
ALTER TABLE "Project" DROP COLUMN "agentBudgetCents";
ALTER TABLE "Project" DROP COLUMN "agentLastError";
