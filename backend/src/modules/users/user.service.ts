
import prisma from "../../lib/prisma.js";

export async function createUser() {
  const user = await prisma.user.create({
    data: {
      firstName: "Gursimran",
      lastName: "Grewal",
      email: "gursimran2@example.com",
      passwordHash: "temporary-hash",
    },
  });

  return user;
}