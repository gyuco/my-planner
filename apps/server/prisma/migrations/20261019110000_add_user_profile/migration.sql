-- Profilo utente: nome, cognome ed email personale.
--
-- Nome e cognome sono NOT NULL con default vuoto per non invalidare gli utenti
-- esistenti: la UI usa lo username come fallback finche' non vengono compilati.
-- L'email e' opzionale e non partecipa al login (resta username/password).
ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "email" TEXT;
