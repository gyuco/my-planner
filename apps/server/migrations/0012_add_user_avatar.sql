-- Migration D1 #12: avatar utente (data URL) e sua versione.
--
-- Stessa modifica della migrazione Prisma 20261111120000_add_user_avatar.
ALTER TABLE "User" ADD COLUMN "avatar" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUpdatedAt" DATETIME;
