/*
  Warnings:

  - You are about to drop the column `items` on the `order` table. All the data in the column will be lost.
  - Added the required column `cartId` to the `order` table without a default value. This is not possible if the table is not empty.
  - Made the column `finalAmount` on table `order` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "order_userId_key";

-- AlterTable
ALTER TABLE "order" DROP COLUMN "items",
ADD COLUMN     "cartId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "fullName" DROP NOT NULL,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL,
ALTER COLUMN "finalAmount" SET NOT NULL;
