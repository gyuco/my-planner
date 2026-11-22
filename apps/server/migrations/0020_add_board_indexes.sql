-- Migration D1 #20: indici per board e archivio dei completati.
-- Stessa modifica della migrazione Prisma 20261123000000_add_board_indexes.
CREATE INDEX "Task_projectId_status_position_idx" ON "Task"("projectId", "status", "position");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_status_updatedAt_idx" ON "Task"("status", "updatedAt");
CREATE INDEX "TaskDependency_blockedByTaskId_idx" ON "TaskDependency"("blockedByTaskId");
