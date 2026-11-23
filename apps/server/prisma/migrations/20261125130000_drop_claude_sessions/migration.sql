-- Rimuove la vista "In corso" (sessioni di Claude Code via hook). Nessun'altra tabella le referenzia.
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ClaudeSession";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SessionHookToken";
PRAGMA foreign_keys=on;

