import jwt from "jsonwebtoken";

// The FitAI session (ADR-004): a stateless HS256 JWT `{ userId }` signed with
// JWT_SECRET and valid for one hour. Every sign-in method issues exactly this
// token (password today; Google and Apple later, ADR-028), so the frontend,
// the auth middleware and per-user data isolation never depend on how the
// user signed in.

export const SESSION_TOKEN_ALGORITHM = "HS256";
export const SESSION_TOKEN_EXPIRES_IN = "1h";

export interface SessionClaims {
  userId: number;
}

export function issueSessionToken(userId: number): string {
  return jwt.sign({ userId } satisfies SessionClaims, process.env.JWT_SECRET!, {
    algorithm: SESSION_TOKEN_ALGORITHM,
    expiresIn: SESSION_TOKEN_EXPIRES_IN,
  });
}

/** Throws for a bad signature, an expired token or any algorithm other than HS256. */
export function verifySessionToken(token: string): SessionClaims {
  return jwt.verify(token, process.env.JWT_SECRET!, {
    algorithms: [SESSION_TOKEN_ALGORITHM],
  }) as SessionClaims;
}
