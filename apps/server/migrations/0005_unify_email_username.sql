-- Migration D1 #5: unifica email e username (email = identificativo di accesso).
--
-- Gli utenti esistenti senza email ereditano lo username (minuscolo), così il
-- login resta invariato finché non aggiornano l'email dal profilo. La tabella
-- viene ricostruita per rendere email NOT NULL + UNIQUE e rimuovere username.
UPDATE "User" SET "email" = LOWER(TRIM("username")) WHERE "email" IS NULL OR TRIM("email") = '';

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "firstName", "id", "lastName", "passwordHash", "role")
SELECT "createdAt", "email", "firstName", "id", "lastName", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
