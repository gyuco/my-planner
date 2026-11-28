-- Migration D1 #26: pre-triage dei task con Gemini (testo, su richiesta).
-- Stessa modifica della migrazione Prisma 20261127180000_add_pretriage_settings.
--
-- Riusa la chiave API dell'assistente vocale (VoiceSettings.apiKeyEnc): qui
-- solo l'interruttore e il modello di testo, separato dal modello Live.

ALTER TABLE "VoiceSettings" ADD COLUMN "pretriageEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VoiceSettings" ADD COLUMN "pretriageModel" TEXT NOT NULL DEFAULT 'gemini-flash-lite-latest';
