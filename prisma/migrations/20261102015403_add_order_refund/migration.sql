-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'CANCELED');

-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "providerRefundId" TEXT,
    "idempotenceKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_orderId_key" ON "refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_paymentId_key" ON "refund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_providerRefundId_key" ON "refund"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "refund_idempotenceKey_key" ON "refund"("idempotenceKey");

-- CreateIndex
CREATE INDEX "refund_status_createdAt_idx" ON "refund"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
