-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PROCESSING', 'BOOKED', 'FAILED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_holdId_key" ON "Order"("holdId");
CREATE INDEX "Order_eventId_seatId_idx" ON "Order"("eventId", "seatId");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");