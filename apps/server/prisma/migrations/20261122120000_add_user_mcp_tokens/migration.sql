-- Token MCP globali per utente (endpoint /mcp/global, login web OAuth). Idempotente.
CREATE TABLE IF NOT EXISTS "UserMcpToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "UserMcpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserMcpToken_tokenHash_key" ON "UserMcpToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "UserMcpToken_userId_idx" ON "UserMcpToken"("userId");
