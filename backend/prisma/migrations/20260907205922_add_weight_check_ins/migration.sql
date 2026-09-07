-- CreateTable
CREATE TABLE "WeightCheckIn" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeightCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeightCheckIn_userId_recordedAt_idx" ON "WeightCheckIn"("userId", "recordedAt");

-- AddForeignKey
ALTER TABLE "WeightCheckIn" ADD CONSTRAINT "WeightCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
