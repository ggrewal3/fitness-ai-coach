-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'OTHER');

-- CreateEnum
CREATE TYPE "NutritionSource" AS ENUM ('MANUAL', 'AI_TEXT', 'AI_PHOTO');

-- DropForeignKey
ALTER TABLE "NutritionEntry" DROP CONSTRAINT "NutritionEntry_userId_fkey";

-- DropTable
DROP TABLE "NutritionEntry";

-- CreateTable
CREATE TABLE "NutritionFoodItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "foodName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "calories" INTEGER NOT NULL,
    "proteinGrams" DOUBLE PRECISION NOT NULL,
    "carbsGrams" DOUBLE PRECISION NOT NULL,
    "fatGrams" DOUBLE PRECISION NOT NULL,
    "mealType" "MealType" NOT NULL,
    "source" "NutritionSource" NOT NULL DEFAULT 'MANUAL',
    "entryDate" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionFoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NutritionFoodItem_userId_entryDate_idx" ON "NutritionFoodItem"("userId", "entryDate");

-- CreateIndex
CREATE INDEX "NutritionFoodItem_userId_recordedAt_idx" ON "NutritionFoodItem"("userId", "recordedAt");

-- AddForeignKey
ALTER TABLE "NutritionFoodItem" ADD CONSTRAINT "NutritionFoodItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

