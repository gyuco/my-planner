-- Migration D1 #24: rimuove la vista "In corso" (sessioni di Claude Code via hook).
-- Stessa modifica della migrazione Prisma 20261125130000_drop_claude_sessions.
DROP INDEX IF EXISTS "ClaudeSession_userId_sessionId_key";
DROP INDEX IF EXISTS "ClaudeSession_projectId_idx";
DROP INDEX IF EXISTS "ClaudeSession_lastSeenAt_idx";
DROP TABLE IF EXISTS "ClaudeSession";
DROP INDEX IF EXISTS "SessionHookToken_userId_idx";
DROP INDEX IF EXISTS "SessionHookToken_tokenHash_key";
DROP TABLE IF EXISTS "SessionHookToken";
