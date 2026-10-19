-- Migration D1 #6: notifiche locali (event log + cursore di lettura per utente).
--
-- TaskEvent e' append-only e l'id autoincrementale fa da cursore per il client.
-- NotificationState ha una riga per utente con l'ultimo evento considerato
-- letto; nessun fan-out di notifiche per destinatario.

CREATE TABLE "TaskEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "NotificationState" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "lastSeenEventId" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TaskEvent_projectId_id_idx" ON "TaskEvent"("projectId", "id");
CREATE INDEX "TaskEvent_id_idx" ON "TaskEvent"("id");
