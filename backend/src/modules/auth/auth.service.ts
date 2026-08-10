import bcrypt from "bcrypt";
import prisma from "../../lib/prisma.js";
import { RegisterUserInput, LoginUserInput } from "./auth.types.js";

export async function registerUser(userData: RegisterUserInput) {
  const existingUser = await prisma.user.findUnique({
    where: {
      email: userData.email,
    },
  });

  if (existingUser) {
    return {
      success: false,
      message: "Email already registered.",
    };
  }

  const hashedPassword = await bcrypt.hash(userData.password, 10);

  const user = await prisma.user.create({
    data: {
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email,
      passwordHash: hashedPassword,
    },
  });

  return {
    success: true,
    user,
  };
}


export async function loginUser(userData: LoginUserInput) {
  const user = await prisma.user.findUnique({
    where: {
      email: userData.email,
    },
  });

  if (!user) {
    
    return {
      success: false,
      message: "Invalid email or password.",
    };
  }
  const isPasswordCorrect = await bcrypt.compare(
  userData.password,
  user.passwordHash
);
if (!isPasswordCorrect) {
  return {
    success: false,
    message: "Invalid email or password.",
  };
}
  return {

    success: true,

    user: {

      id: user.id,

      firstName: user.firstName,

      lastName: user.lastName,

      email: user.email,

    },

  };

}