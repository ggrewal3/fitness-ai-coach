// Idempotent seed for the built-in FitAI exercise catalogue.
// Run with: npm run db:seed (or npx prisma db seed)
import prisma from "../src/lib/prisma.js";
import { seedBuiltInExercises } from "../src/modules/exercises/exercise.service.js";

async function main() {
  const result = await seedBuiltInExercises(prisma);

  console.log(
    `Built-in exercises: ${result.total} total, ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`
  );
}

main()
  .catch((error: unknown) => {
    console.error("Exercise seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
