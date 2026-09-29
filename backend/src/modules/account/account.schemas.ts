import { z } from "zod";
import { isCountryCode } from "./countryCodes.js";

export const NAME_MAX_LENGTH = 50;
export const BIO_MAX_LENGTH = 500;
const PHONE_INPUT_MAX_LENGTH = 40;

// E.164-style: "+", a non-zero country digit, 8–15 digits in total.
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
// Common human formatting removed before validation: spaces, hyphens,
// periods and parentheses ("+1 (415) 555-0100" -> "+14155550100").
const PHONE_FORMATTING_PATTERN = /[ .()-]/g;
// C0/C1 control characters except tab and line feed. Carriage returns are
// normalized to line feeds before this check.
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters.`);

const phoneSchema = z
  .string()
  .max(PHONE_INPUT_MAX_LENGTH, "Enter a valid international phone number.")
  .transform((value, context) => {
    const compact = value.trim().replace(PHONE_FORMATTING_PATTERN, "");

    if (compact === "") {
      return null;
    }

    if (!E164_PATTERN.test(compact)) {
      context.addIssue({
        code: "custom",
        message:
          "Enter a valid international phone number starting with + and a country code.",
      });
      return z.NEVER;
    }

    return compact;
  })
  .nullable();

const countryCodeSchema = z
  .string()
  .transform((value, context) => {
    const code = value.trim().toUpperCase();

    if (code === "") {
      return null;
    }

    if (!isCountryCode(code)) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid ISO 3166-1 alpha-2 country code.",
      });
      return z.NEVER;
    }

    return code;
  })
  .nullable();

// Plain text only: stored and returned verbatim, never rendered as HTML.
const bioSchema = z
  .string()
  .transform((value, context) => {
    const bio = value.replace(/\r\n?/g, "\n").trim();

    if (bio === "") {
      return null;
    }

    if (DISALLOWED_CONTROL_PATTERN.test(bio)) {
      context.addIssue({
        code: "custom",
        message: "Bio contains invalid control characters.",
      });
      return z.NEVER;
    }

    if (bio.length > BIO_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message: `Bio must be at most ${BIO_MAX_LENGTH} characters.`,
      });
      return z.NEVER;
    }

    return bio;
  })
  .nullable();

function hasAtLeastOneField(value: Record<string, unknown>): boolean {
  return Object.values(value).some((field) => field !== undefined);
}

// Only report "empty update" when nothing else is wrong; otherwise a body like
// { email: "..." } would also get a misleading "provide a field" error.
const onlyWhenValid = { when: ({ issues }: { issues: unknown[] }) => issues.length === 0 };

// Email is deliberately absent: it is read-only in Settings V1, and strict()
// rejects it (and userId) as unrecognized keys.
export const updateAccountProfileSchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: phoneSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    bio: bioSchema.optional(),
  })
  .strict()
  .refine(hasAtLeastOneField, {
    message: "Provide at least one field to update.",
    ...onlyWhenValid,
  });

const weightUnitSchema = z.enum(["KG", "LB"]);
const heightUnitSchema = z.enum(["CM", "FT_IN"]);

export const updatePreferencesSchema = z
  .object({
    bodyWeightUnit: weightUnitSchema.optional(),
    workoutLoadUnit: weightUnitSchema.optional(),
    heightUnit: heightUnitSchema.optional(),
  })
  .strict()
  .refine(hasAtLeastOneField, {
    message: "Provide at least one preference to update.",
    ...onlyWhenValid,
  });
