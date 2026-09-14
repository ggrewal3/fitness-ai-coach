-- CreateTable
CREATE TABLE "NutritionEntry" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "entryDate" DATE NOT NULL,
    "calories" INTEGER NOT NULL,
    "proteinGrams" DOUBLE PRECISION NOT NULL,
    "carbsGrams" DOUBLE PRECISION NOT NULL,
    "fatGrams" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NutritionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NutritionEntry_userId_recordedAt_idx" ON "NutritionEntry"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionEntry_userId_entryDate_key" ON "NutritionEntry"("userId", "entryDate");

-- AddForeignKey
ALTER TABLE "NutritionEntry" ADD CONSTRAINT "NutritionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
