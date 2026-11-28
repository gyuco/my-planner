-- AlterTable
ALTER TABLE "VoiceSettings" ADD COLUMN "pretriageEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VoiceSettings" ADD COLUMN "pretriageModel" TEXT NOT NULL DEFAULT 'gemini-flash-lite-latest';
