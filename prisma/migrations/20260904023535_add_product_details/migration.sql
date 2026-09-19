-- AlterTable
ALTER TABLE "product" ADD COLUMN     "details" TEXT[] DEFAULT ARRAY[]::TEXT[];
