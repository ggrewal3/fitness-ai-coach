import { z } from "zod";

// bcrypt only uses the first 72 bytes of a password, so longer passwords are
// rejected rather than silently truncated. Measured in UTF-8 bytes, not
// JavaScript string length (e.g. "é" is 2 bytes, most emoji are 4).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

// Emails are stored trimmed and lower-cased, so lookups are case-insensitive
// through normalization.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address.");

export const registerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  email: emailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, "Password must be at least 8 characters.")
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_BYTES,
      "Password must be at most 72 bytes (some characters count as more than one)."
    ),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

/** Providers that can issue sign-in nonces. */
export const nonceRequestSchema = z
  .object({
    provider: z.enum(["GOOGLE", "APPLE"]),
  })
  .strict();

// Only what the backend needs: the provider's ID token and the nonce FitAI
// issued for it. Identity claims come from the signed token alone.
const credentialSchema = z.string().min(1, "Credential is required.").max(8192, "Credential is too long.");
const nonceSchema = z.string().min(1, "Nonce is required.").max(128, "Nonce is too long.");

export const googleSignInSchema = z
  .object({
    credential: credentialSchema,
    nonce: nonceSchema,
  })
  .strict();

// Apple's first authorization also sends the user's name to the browser (it
// is not in the signed token). Bounded here; trimmed and cut to the account
// name rules when a new account is created. Never identity evidence.
const appleNameSchema = z.string().max(200, "Name is too long.").optional();

export const appleSignInSchema = z
  .object({
    idToken: credentialSchema,
    nonce: nonceSchema,
    firstName: appleNameSchema,
    lastName: appleNameSchema,
  })
  .strict();
