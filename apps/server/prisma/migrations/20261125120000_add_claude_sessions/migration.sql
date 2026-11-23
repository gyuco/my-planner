-- Sessioni di Claude Code segnalate dagli hook e token degli hook (vista "In corso").
-- CreateTable
CREATE TABLE "SessionHookToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "SessionHookToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaudeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'cli',
    "url" TEXT,
    "repo" TEXT,
    "branch" TEXT,
    "workdir" TEXT,
    "lastMessage" TEXT,
    "projectId" TEXT,
    "taskId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "ClaudeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaudeSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ClaudeSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionHookToken_tokenHash_key" ON "SessionHookToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SessionHookToken_userId_idx" ON "SessionHookToken"("userId");

-- CreateIndex
CREATE INDEX "ClaudeSession_lastSeenAt_idx" ON "ClaudeSession"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ClaudeSession_projectId_idx" ON "ClaudeSession"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeSession_userId_sessionId_key" ON "ClaudeSession"("userId", "sessionId");

