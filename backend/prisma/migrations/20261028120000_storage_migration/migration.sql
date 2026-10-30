CREATE TABLE "StorageMigration" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageMigration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StorageMigration_source_destination_key" ON "StorageMigration"("source", "destination");
CREATE TABLE "StorageMigrationItem" (
  "migrationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "size" BIGINT NOT NULL DEFAULT 0,
  "sha256" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageMigrationItem_pkey" PRIMARY KEY ("migrationId", "key"),
  CONSTRAINT "StorageMigrationItem_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "StorageMigration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
