-- CreateTable
CREATE TABLE "StorageSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "backend" TEXT NOT NULL DEFAULT 'local',
    "localDir" TEXT NOT NULL DEFAULT './attachments/local',
    "s3Endpoint" TEXT,
    "s3Bucket" TEXT,
    "s3Region" TEXT,
    "s3AccessKeyId" TEXT,
    "s3SecretAccessKey" TEXT,
    "updatedAt" DATETIME NOT NULL
);
