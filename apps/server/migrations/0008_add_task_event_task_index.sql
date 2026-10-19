-- Migration D1 #8: log attivita' per task.
--
-- TaskEvent ora registra tutte le mutazioni dei task (non solo quelle che
-- generano notifiche); il drawer del task legge il log filtrando per taskId.

CREATE INDEX "TaskEvent_taskId_id_idx" ON "TaskEvent"("taskId", "id");
