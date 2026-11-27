-- CreateTable
CREATE TABLE "VoiceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEnc" TEXT,
    "model" TEXT NOT NULL DEFAULT 'gemini-3.8-live',
    "voiceName" TEXT,
    "updatedAt" DATETIME NOT NULL
);
