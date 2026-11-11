-- Avatar utente caricato dal profilo (data URL) e sua versione.
ALTER TABLE "User" ADD COLUMN "avatar" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUpdatedAt" DATETIME;
