-- Indici per board e archivio dei completati.
CREATE INDEX "Task_projectId_status_position_idx" ON "Task"("projectId", "status", "position");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_status_updatedAt_idx" ON "Task"("status", "updatedAt");
CREATE INDEX "TaskDependency_blockedByTaskId_idx" ON "TaskDependency"("blockedByTaskId");
