-- Ruoli utente (admin | manager) e associazione manager -> progetti.
--
-- Il default "admin" e' intenzionale: gli utenti creati prima dell'introduzione
-- dei ruoli sono l'unico account esistente ed avevano gia' accesso completo.
-- I nuovi utenti creati dall'API hanno sempre un ruolo esplicito (default
-- applicativo "manager", vedi apps/server/src/lib/validation.ts).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'admin';

-- CreateTable
CREATE TABLE "UserProject" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "projectId"),
    CONSTRAINT "UserProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserProject_projectId_idx" ON "UserProject"("projectId");
