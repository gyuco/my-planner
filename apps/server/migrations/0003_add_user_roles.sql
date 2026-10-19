-- Migration D1 #3: ruoli utente e associazione manager -> progetti.
--
-- "admin" ha accesso a tutto e gestisce gli utenti; "manager" accede solo ai
-- progetti elencati in UserProject. Il default 'admin' mantiene l'accesso
-- completo all'utente gia' esistente dopo l'aggiornamento: i nuovi utenti
-- creati dall'API hanno sempre un ruolo esplicito.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'admin';

CREATE TABLE "UserProject" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    PRIMARY KEY ("userId", "projectId"),
    CONSTRAINT "UserProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UserProject_projectId_idx" ON "UserProject"("projectId");
