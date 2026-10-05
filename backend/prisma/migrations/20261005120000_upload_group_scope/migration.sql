-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "serverWide" BOOLEAN NOT NULL DEFAULT false;
