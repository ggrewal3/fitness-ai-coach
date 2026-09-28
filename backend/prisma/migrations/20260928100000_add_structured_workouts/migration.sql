-- CreateEnum
CREATE TYPE "LoadUnit" AS ENUM ('KG', 'LB');

-- AlterTable: add the new WorkoutSession columns as nullable first so existing
-- rows can be backfilled before the NOT NULL constraints are applied.
ALTER TABLE "WorkoutSession" ADD COLUMN     "title" TEXT,
ADD COLUMN     "workoutDate" DATE;

-- Backfill existing sessions. recordedAt is stored in UTC, so the derived
-- workoutDate is the UTC calendar date; titles are generated from the
-- training type (e.g. "Strength workout", "Cardio workout").
UPDATE "WorkoutSession"
SET "workoutDate" = "recordedAt"::date,
    "title" = initcap(lower("trainingType"::text)) || ' workout'
WHERE "workoutDate" IS NULL OR "title" IS NULL;

ALTER TABLE "WorkoutSession" ALTER COLUMN "title" SET NOT NULL,
ALTER COLUMN "workoutDate" SET NOT NULL;

-- CreateTable
CREATE TABLE "Exercise" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "builtInKey" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" SERIAL NOT NULL,
    "workoutSessionId" INTEGER NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" SERIAL NOT NULL,
    "workoutExerciseId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "load" DECIMAL(6,2),
    "loadUnit" "LoadUnit",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_builtInKey_key" ON "Exercise"("builtInKey");

-- CreateIndex
CREATE INDEX "Exercise_normalizedName_idx" ON "Exercise"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_userId_normalizedName_key" ON "Exercise"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "WorkoutExercise_exerciseId_idx" ON "WorkoutExercise"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutExercise_workoutSessionId_position_key" ON "WorkoutExercise"("workoutSessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSet_workoutExerciseId_position_key" ON "WorkoutSet"("workoutExerciseId", "position");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_workoutDate_idx" ON "WorkoutSession"("userId", "workoutDate");

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_workoutSessionId_fkey" FOREIGN KEY ("workoutSessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_workoutExerciseId_fkey" FOREIGN KEY ("workoutExerciseId") REFERENCES "WorkoutExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
