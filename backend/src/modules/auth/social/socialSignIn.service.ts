import { Prisma, type AuthProvider } from "../../../generated/prisma/client.js";
import prisma from "../../../lib/prisma.js";
import { NAME_MAX_LENGTH } from "../../account/account.schemas.js";
import { emailSchema } from "../auth.schemas.js";
import { issueSessionToken } from "../session.js";

// Resolving a verified provider identity to a FitAI account (ADR-028).
// The person is recognised ONLY by provider + subject. Email is used once, to
// fill in a new account and to refuse creating a second account for an
// address FitAI already has; it never finds or links an existing account.

/**
 * Names for a new account when the provider gives no usable name. User names
 * are required (account settings validate 1–50 characters), so this neutral
 * placeholder fills the gap until the user edits it in Settings or a future
 * onboarding step asks for it.
 */
export const FALLBACK_NAME = { firstName: "FitAI", lastName: "Member" } as const;

// C0/C1 control characters become spaces before trimming.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/** A display name within the account constraints, or null if nothing usable is left. */
export function usableName(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  // Cut by code points so a surrogate pair is never split.
  return [...cleaned].slice(0, NAME_MAX_LENGTH).join("").trim();
}

export interface ProviderIdentity {
  provider: AuthProvider;
  subject: string;
  /** From the signed token; null when the provider sent none. */
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
  firstName: string | null;
  lastName: string | null;
}

export type SocialSignInResult =
  | { ok: true; outcome: "login" | "created"; token: string; user: PublicUser; isNewUser: boolean }
  | { ok: false; outcome: "email_conflict" | "missing_email" | "unverified_email" };

interface PublicUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

const publicUserSelect = { id: true, firstName: true, lastName: true, email: true } as const;

function signedIn(user: PublicUser, isNewUser: boolean): SocialSignInResult {
  return { ok: true, outcome: isNewUser ? "created" : "login", token: issueSessionToken(user.id), user, isNewUser };
}

/** The identity's provider email, kept current for display; never User.email. */
function verifiedProviderEmail(identity: ProviderIdentity): string | null {
  if (!identity.email || !identity.emailVerified) return null;
  const parsed = emailSchema.safeParse(identity.email);
  return parsed.success ? parsed.data : null;
}

async function loginExisting(identityId: number, identity: ProviderIdentity): Promise<SocialSignInResult> {
  // The identity's email (and whether it is an Apple relay address) is
  // refreshed only from a verified email in the signed token.
  const providerEmail = verifiedProviderEmail(identity);
  const updated = await prisma.authIdentity.update({
    where: { id: identityId },
    data: { lastUsedAt: new Date(), ...(providerEmail ? { email: providerEmail, isPrivateEmail: identity.isPrivateEmail } : {}) },
    select: { user: { select: publicUserSelect } },
  });
  return signedIn(updated.user, false);
}

export async function signInWithProviderIdentity(identity: ProviderIdentity): Promise<SocialSignInResult> {
  const key = { provider_providerSubject: { provider: identity.provider, providerSubject: identity.subject } };

  const existing = await prisma.authIdentity.findUnique({ where: key, select: { id: true } });
  if (existing) return loginExisting(existing.id, identity);

  // A new account needs a usable email that the provider has verified. The
  // name never substitutes for it, and no placeholder email is invented.
  if (!identity.email || !emailSchema.safeParse(identity.email).success) return { ok: false, outcome: "missing_email" };
  const email = verifiedProviderEmail(identity);
  if (!email) return { ok: false, outcome: "unverified_email" };

  // Never attach this identity to an existing account by email (no linking until Phase 5B).
  const emailTaken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (emailTaken) return { ok: false, outcome: "email_conflict" };

  try {
    const user = await prisma.user.create({
      data: {
        firstName: usableName(identity.firstName) ?? FALLBACK_NAME.firstName,
        lastName: usableName(identity.lastName) ?? FALLBACK_NAME.lastName,
        email,
        passwordHash: null,
        authIdentities: {
          create: {
            provider: identity.provider,
            providerSubject: identity.subject,
            email,
            isPrivateEmail: identity.isPrivateEmail,
          },
        },
      },
      select: publicUserSelect,
    });
    return signedIn(user, true);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;

    // Lost a race. If a simultaneous first sign-in created this identity, this
    // is a normal login; otherwise someone took the email meanwhile.
    const winner = await prisma.authIdentity.findUnique({ where: key, select: { id: true } });
    if (winner) return loginExisting(winner.id, identity);
    return { ok: false, outcome: "email_conflict" };
  }
}
