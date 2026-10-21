-- Migration D1 #11: destinatario delle notifiche sull'evento.
--
-- Notifiche ed email vanno solo all'assegnatario del task (se non e' lui
-- l'autore dell'azione), deciso quando l'evento viene scritto. Gli eventi
-- esistenti restano senza destinatario: non generano piu' notifiche.

ALTER TABLE "TaskEvent" ADD COLUMN "recipientId" TEXT;
CREATE INDEX "TaskEvent_recipientId_id_idx" ON "TaskEvent"("recipientId", "id");
