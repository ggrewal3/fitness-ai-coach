import { Request, Response } from "express";
import type { AuthProvider } from "../../generated/prisma/client.js";
import { loginUser, registerUser } from "./auth.service.js";
import { verifyAppleIdToken } from "./social/appleIdToken.js";
import { verifyGoogleIdToken } from "./social/googleIdToken.js";
import { signInNonces } from "./social/nonceStore.js";
import { SocialTokenError } from "./social/providerToken.js";
import { signInWithProviderIdentity, type ProviderIdentity } from "./social/socialSignIn.service.js";

export async function register(req: Request, res: Response) {
  try {
    const result = await registerUser(req.body);

    if (!result.success) {
  return res.status(409).json({
    message: result.message,
  });
}

return res.status(201).json(result.user);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const result = await loginUser(req.body);

    if (!result.success) {
      return res.status(401).json({
        message: result.message,
      });
    }

    return res.status(200).json({
      token: result.token,
      user: result.user,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

// ---------------------------------------------------------------------------
// Social sign-in (ADR-028). One flow for every provider; each provider only
// supplies its configuration, token verifier and wording. Public errors are
// stable and generic; the reason is only in the server log, which never
// contains the ID token, the nonce, the provider subject, emails or names.

export type SocialAuthOutcome =
  | "login"
  | "created"
  | "email_conflict"
  | "invalid_token"
  | "wrong_audience"
  | "expired"
  | "nonce_invalid"
  | "missing_email"
  | "unverified_email"
  | "not_configured"
  | "provider_unavailable"
  | "error";

const EMAIL_IN_USE = {
  code: "EMAIL_IN_USE",
  message: "An account with this email already exists. Sign in the way you usually do, for example with your password.",
};

interface SocialProviderConfig {
  /** The configured client ID (token audience), or null when the provider is off. */
  clientId(): string | null;
  /** Verifies the request's ID token and returns the identity (provider fields from the signed token only). */
  verify(body: Record<string, unknown>, options: { clientId: string; expectedNonce: string }): Promise<Omit<ProviderIdentity, "provider">>;
  messages: { unavailable: string; notVerified: string; missingEmail: string; unverifiedEmail: string };
}

const configured = (value: string | undefined) => value?.trim() || null;

const SOCIAL_PROVIDERS: Record<AuthProvider, SocialProviderConfig> = {
  GOOGLE: {
    clientId: () => configured(process.env.GOOGLE_CLIENT_ID),
    async verify(body, options) {
      const identity = await verifyGoogleIdToken(body.credential as string, options);
      return {
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        isPrivateEmail: false,
        firstName: identity.givenName,
        lastName: identity.familyName,
      };
    },
    messages: {
      unavailable: "Google sign-in is unavailable right now.",
      notVerified: "We couldn't verify your Google account. Please try again.",
      // Google always sends an email for the requested scopes; both cases keep one message.
      missingEmail: "Your Google account's email isn't verified, so it can't be used to create a FitAI account.",
      unverifiedEmail: "Your Google account's email isn't verified, so it can't be used to create a FitAI account.",
    },
  },
  APPLE: {
    // Apple's Services ID: public configuration, not a secret.
    clientId: () => configured(process.env.APPLE_CLIENT_ID),
    async verify(body, options) {
      const identity = await verifyAppleIdToken(body.idToken as string, options);
      return {
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        isPrivateEmail: identity.isPrivateEmail,
        // Unsigned profile input from Apple's first authorization: used only
        // to name a NEW account, never to find or link one.
        firstName: typeof body.firstName === "string" ? body.firstName : null,
        lastName: typeof body.lastName === "string" ? body.lastName : null,
      };
    },
    messages: {
      unavailable: "Apple sign-in is unavailable right now.",
      notVerified: "We couldn't verify your Apple account. Please try again.",
      missingEmail: "Apple didn't share the email address FitAI needs to create your account.",
      unverifiedEmail: "Your Apple account's email isn't verified, so it can't be used to create a FitAI account.",
    },
  },
};

function logSocialAuth(provider: AuthProvider, outcome: SocialAuthOutcome, startedAt: number, userId?: number) {
  const entry = { event: "auth.social", provider, outcome, latencyMs: Date.now() - startedAt, ...(userId ? { userId } : {}) };
  if (outcome === "error") console.error(entry);
  else console.info(entry);
}

export function issueSignInNonce(req: Request, res: Response) {
  const { provider } = req.body as { provider: AuthProvider };
  const config = SOCIAL_PROVIDERS[provider];

  if (!config.clientId()) {
    return res.status(503).json({ message: config.messages.unavailable });
  }

  const { nonce, expiresAt } = signInNonces.issue(provider);
  return res.status(201).json({ provider, nonce, expiresAt: expiresAt.toISOString() });
}

async function socialSignIn(provider: AuthProvider, req: Request, res: Response) {
  const startedAt = Date.now();
  const config = SOCIAL_PROVIDERS[provider];
  const body = req.body as Record<string, unknown>;
  const nonce = body.nonce as string;
  const clientId = config.clientId();

  if (!clientId) {
    logSocialAuth(provider, "not_configured", startedAt);
    return res.status(503).json({ message: config.messages.unavailable });
  }

  // Consumed before anything else: whatever happens next, this nonce is spent.
  if (!signInNonces.consume(nonce, provider).ok) {
    logSocialAuth(provider, "nonce_invalid", startedAt);
    return res.status(401).json({ message: config.messages.notVerified });
  }

  try {
    const identity = await config.verify(body, { clientId, expectedNonce: nonce });
    const result = await signInWithProviderIdentity({ provider, ...identity });

    if (!result.ok) {
      logSocialAuth(provider, result.outcome, startedAt);
      if (result.outcome === "email_conflict") return res.status(409).json(EMAIL_IN_USE);
      // MISSING_EMAIL lets a client explain what to do; nothing about the token is revealed.
      return result.outcome === "missing_email"
        ? res.status(401).json({ code: "MISSING_EMAIL", message: config.messages.missingEmail })
        : res.status(401).json({ message: config.messages.unverifiedEmail });
    }

    logSocialAuth(provider, result.outcome, startedAt, result.user.id);
    return res.status(200).json({ token: result.token, user: result.user, isNewUser: result.isNewUser });
  } catch (error) {
    if (error instanceof SocialTokenError) {
      const outcome = error.category === "nonce_mismatch" ? "nonce_invalid" : error.category;
      logSocialAuth(provider, outcome, startedAt);
      return error.category === "provider_unavailable"
        ? res.status(503).json({ message: config.messages.unavailable })
        : res.status(401).json({ message: config.messages.notVerified });
    }

    // Never log the error object itself: it could carry request data.
    logSocialAuth(provider, "error", startedAt);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}

export const googleSignIn = (req: Request, res: Response) => socialSignIn("GOOGLE", req, res);
export const appleSignIn = (req: Request, res: Response) => socialSignIn("APPLE", req, res);
