-- AlterTable: optional location tag (lat/lng + free-text label) for a post
ALTER TABLE "Post" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "locationName" TEXT,
ADD COLUMN     "longitude" DOUBLE PRECISION;
