-- Migration D1 #7: configurazione SMTP per le email di notifica (singleton).
--
-- passwordEnc contiene la password SMTP cifrata (AES-GCM, vedi
-- src/lib/secretBox.ts), mai in chiaro. Nessuna riga = email disattivate.

CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 465,
    "security" TEXT NOT NULL DEFAULT 'tls',
    "username" TEXT,
    "passwordEnc" TEXT,
    "fromAddress" TEXT,
    "fromName" TEXT NOT NULL DEFAULT 'my-planner',
    "appUrl" TEXT,
    "updatedAt" DATETIME NOT NULL
);
