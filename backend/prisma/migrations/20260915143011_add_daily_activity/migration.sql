-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('MANUAL', 'APPLE_HEALTH', 'HEALTH_CONNECT');

-- CreateTable
CREATE TABLE "DailyActivity" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "activityDate" DATE NOT NULL,
    "steps" INTEGER NOT NULL,
    "walkingDistanceKm" DOUBLE PRECISION,
    "activeCalories" INTEGER,
    "source" "ActivitySource" NOT NULL DEFAULT 'MANUAL',
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyActivity_userId_recordedAt_idx" ON "DailyActivity"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyActivity_userId_activityDate_key" ON "DailyActivity"("userId", "activityDate");

-- AddForeignKey
ALTER TABLE "DailyActivity" ADD CONSTRAINT "DailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
