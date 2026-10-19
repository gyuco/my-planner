-- Unifica email e username: l'email diventa l'unico identificativo di accesso.
--
-- Backfill: gli utenti esistenti senza email ereditano lo username (in
-- minuscolo), così le credenziali di login restano le stesse. Gli eventuali
-- valori non in formato email restano validi per il login finché l'utente non
-- li aggiorna dalla pagina profilo.
UPDATE "User" SET "email" = LOWER(TRIM("username")) WHERE "email" IS NULL OR TRIM("email") = '';

-- RedefineTables: rimuove username ed rende email NOT NULL + UNIQUE.
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
