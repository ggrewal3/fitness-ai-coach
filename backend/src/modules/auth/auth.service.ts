import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client.js";
import prisma from "../../lib/prisma.js";
import { RegisterUserInput, LoginUserInput } from "./auth.types.js";
import { issueSessionToken } from "./session.js";

/**
 * A fixed, valid bcrypt hash (cost 10, same as real hashes) of a random value
 * nobody knows. Failed logins compare against it when there is no real hash,
 * so an unknown email or an account without a password (Google/Apple only,
 * ADR-028) costs a bcrypt comparison like a wrong password does, instead of
 * returning noticeably faster. This removes the obvious timing difference; it
 * is not a constant-time guarantee.
 */
const DUMMY_PASSWORD_HASH = "$2b$10$9T7sfJ2Xrqzru6lCqgIcau/KRJmx39tlXsynpvwqnbHgLnsUe60Qa";

const INVALID_CREDENTIALS = {
  success: false as const,
  message: "Invalid email or password.",
};


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

  // The email is already normalized by registerSchema; the unique index is the
  // final guard if two registrations for the same address race.
  let user;

  try {
    user = await prisma.user.create({
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
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        message: "Email already registered.",
      };
    }

    throw error;
  }

  return {
    success: true,
    user,
  };
}


/**
 * Password login. Every failure (unknown email, no password on the account,
 * wrong password) returns the same response after one bcrypt comparison.
 */
export async function loginUser(userData: LoginUserInput) {
  const user = await prisma.user.findUnique({
    where: {
      email: userData.email,
    },
  });

  // Never pass null to bcrypt: accounts without a password are compared
  // against the dummy hash and then rejected regardless of the result.
  const passwordHash = user?.passwordHash ?? null;
  const isPasswordCorrect = await bcrypt.compare(userData.password, passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || passwordHash === null || !isPasswordCorrect) {
    return INVALID_CREDENTIALS;
  }

  return {
    success: true as const,
    token: issueSessionToken(user.id),
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    },
  };
}
