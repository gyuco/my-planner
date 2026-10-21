-- AlterTable
ALTER TABLE "TaskEvent" ADD COLUMN "recipientId" TEXT;

-- CreateIndex
CREATE INDEX "TaskEvent_recipientId_id_idx" ON "TaskEvent"("recipientId", "id");
