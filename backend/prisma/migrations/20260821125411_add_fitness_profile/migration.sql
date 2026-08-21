-- CreateEnum
CREATE TYPE "FitnessGoal" AS ENUM ('LOSE_FAT', 'MAINTAIN', 'GAIN_MUSCLE');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "DietPreference" AS ENUM ('NO_PREFERENCE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'HALAL');

-- CreateTable
CREATE TABLE "FitnessProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "heightCm" DOUBLE PRECISION,
    "targetWeightKg" DOUBLE PRECISION,
    "goal" "FitnessGoal",
    "activityLevel" "ActivityLevel",
    "dietPreference" "DietPreference",
    "medicalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FitnessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FitnessProfile_userId_key" ON "FitnessProfile"("userId");

-- AddForeignKey
ALTER TABLE "FitnessProfile" ADD CONSTRAINT "FitnessProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
