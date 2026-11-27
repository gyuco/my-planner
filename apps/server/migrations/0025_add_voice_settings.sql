-- Migration D1 #25: assistente vocale Gemini Live (singleton).
-- Stessa modifica della migrazione Prisma 20261127120000_add_voice_settings.
--
-- apiKeyEnc contiene la chiave Google AI Studio cifrata (AES-GCM, vedi
-- src/lib/secretBox.ts), mai in chiaro. Nessuna riga = assistente spento.

CREATE TABLE "VoiceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEnc" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gemini-3.8-live',
    "voiceName" TEXT,
    "updatedAt" DATETIME NOT NULL
);
