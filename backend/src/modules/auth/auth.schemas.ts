import { z } from "zod";

// bcrypt only uses the first 72 bytes of a password, so longer passwords are
// rejected rather than silently truncated. Measured in UTF-8 bytes, not
// JavaScript string length (e.g. "é" is 2 bytes, most emoji are 4).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

// Emails are stored trimmed and lower-cased, so lookups are case-insensitive
// through normalization.
const emailSchema = z
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
