-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CARD', 'CASH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'DRAFT';
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "deliveryFee" INTEGER,
ADD COLUMN     "deliveryTime" TEXT,
ADD COLUMN     "paymentCardId" TEXT,
ADD COLUMN     "paymentType" "PaymentType" NOT NULL DEFAULT 'CARD';
