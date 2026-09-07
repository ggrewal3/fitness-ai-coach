import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
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
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      createdAt: true,
      updatedAt: true,
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
  success: false as const,
  message: "Invalid email or password.",
};
}
const token = jwt.sign(
  {
    userId: user.id,
  },
  process.env.JWT_SECRET!,
  {
    expiresIn: "1h",
  }
);
  return {
  success: true as const,
  token,
  user: {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  },
};
}
