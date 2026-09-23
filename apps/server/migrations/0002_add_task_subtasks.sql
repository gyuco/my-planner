-- Migration number: 0002 	 2026-09-23T19:48:53.516Z

-- Sotto-task: Task.parentId self-relation, un solo livello di annidamento
-- (vedi apps/server/prisma/schema.prisma e API_CONTRACT.md §4/§7). Colonna
-- nullable aggiunta a una tabella gia' esistente: nessun data-fix necessario,
-- tutte le righe correnti diventano task di primo livello (parentId NULL).
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT REFERENCES "Task" ("id");
