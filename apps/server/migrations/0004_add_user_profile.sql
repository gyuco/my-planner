-- Migration D1 #4: profilo utente (nome, cognome, email personale).
--
-- Stessa modifica della migrazione Prisma 20261019110000_add_user_profile.
-- Nome/cognome vuoti di default per gli utenti gia' esistenti; l'email e'
-- opzionale e non viene usata per il login (resta username/password).
ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "email" TEXT;
