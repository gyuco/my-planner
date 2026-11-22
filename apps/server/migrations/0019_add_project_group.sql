-- Migration D1 #19: gruppo del progetto (solo visuale, sidebar).
-- Stessa modifica della migrazione Prisma 20261122230000_add_project_group.
ALTER TABLE "Project" ADD COLUMN "groupName" TEXT;
