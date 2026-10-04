// Safety gates for live AI Coach evaluation (ADR-027). Pure functions with no
// database or provider imports, so they run (and are tested) before anything
// can connect anywhere.

export const EVAL_LIMITS = {
  defaultRepeat: 1,
  maxRepeat: 5,
  /** Emergency ceilings, not expected consumption. */
  maxProviderCalls: 150,
  maxTotalTokens: 1_000_000,
} as const;

export interface EvalOptions {
  scenarios: string[] | null;
  repeat: number;
  judge: boolean;
  confirmLive: boolean;
  dryRun: boolean;
  maxProviderCalls: number;
  maxTotalTokens: number;
}

export class EvalGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalGuardError";
  }
}

function positiveInteger(flag: string, value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new EvalGuardError(`${flag} needs a positive whole number.`);
  }
  return Number(value);
}

/** Parses CLI arguments. Budgets can only be lowered, never raised past the ceilings. */
export function parseEvalArgs(argv: readonly string[]): EvalOptions {
  const options: EvalOptions = {
    scenarios: null,
    repeat: EVAL_LIMITS.defaultRepeat,
    judge: false,
    confirmLive: false,
    dryRun: false,
    maxProviderCalls: EVAL_LIMITS.maxProviderCalls,
    maxTotalTokens: EVAL_LIMITS.maxTotalTokens,
  };

  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];

    switch (flag) {
      case "--scenarios":
        if (!value) throw new EvalGuardError("--scenarios needs a comma-separated list, e.g. --scenarios=S1,S15.");
        options.scenarios = value.split(",").map((id) => id.trim().toUpperCase()).filter(Boolean);
        break;
      case "--repeat":
        options.repeat = positiveInteger(flag, value);
        if (options.repeat > EVAL_LIMITS.maxRepeat) throw new EvalGuardError(`--repeat may be at most ${EVAL_LIMITS.maxRepeat}.`);
        break;
      case "--max-provider-calls":
        options.maxProviderCalls = Math.min(positiveInteger(flag, value), EVAL_LIMITS.maxProviderCalls);
        break;
      case "--max-tokens":
        options.maxTotalTokens = Math.min(positiveInteger(flag, value), EVAL_LIMITS.maxTotalTokens);
        break;
      case "--judge":
        options.judge = true;
        break;
      case "--confirm-live":
        options.confirmLive = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new EvalGuardError(`Unknown argument: ${flag}`);
    }
  }

  return options;
}

/** host:port/database, or null for an unparseable connection string. Never includes credentials. */
export function databaseIdentity(connectionString: string): { identity: string; database: string } | null {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!database) return null;
    return { identity: `${url.hostname}:${url.port || "5432"}/${database}`, database };
  } catch {
    return null;
  }
}

/** Test database names must say so; the project's is `fitness_ai_test`. */
export const TEST_DATABASE_NAME = /_test$/;

/**
 * Positively establishes, from configuration alone, that the evaluation
 * database is a test database and not the development database. Compares
 * both the full identity and the bare database name, so a host alias
 * (localhost vs 127.0.0.1) cannot disguise the development database.
 */
export function checkDatabaseIsolation(testUrl: string | undefined, developmentUrls: readonly (string | undefined)[]): { database: string } {
  if (!testUrl) {
    throw new EvalGuardError("TEST_DATABASE_URL is not set. Live evaluation runs only against the dedicated test database.");
  }

  const test = databaseIdentity(testUrl);
  if (!test) throw new EvalGuardError("TEST_DATABASE_URL is not a valid connection string.");

  if (!TEST_DATABASE_NAME.test(test.database)) {
    throw new EvalGuardError("Refusing to run: the test database name must end with \"_test\".");
  }

  const known = developmentUrls.filter((url): url is string => Boolean(url)).map(databaseIdentity);
  if (known.length === 0) {
    throw new EvalGuardError("Refusing to run: the development DATABASE_URL could not be read, so isolation cannot be verified.");
  }

  for (const development of known) {
    if (!development || development.identity === test.identity || development.database === test.database) {
      throw new EvalGuardError("Refusing to run: TEST_DATABASE_URL points at (or cannot be distinguished from) the development database.");
    }
  }

  return { database: test.database };
}

/** After connecting: the server must report the expected test database. */
export function checkConnectedDatabase(actual: string, expected: string, developmentNames: readonly string[]): void {
  if (actual !== expected || !TEST_DATABASE_NAME.test(actual) || developmentNames.includes(actual)) {
    throw new EvalGuardError("Refusing to run: the connected database is not the verified test database.");
  }
}

/** Live-provider opt-in. Every requirement must hold; nothing secret is echoed. */
export function checkLiveOptIn(env: Record<string, string | undefined>, options: EvalOptions): { model: string } {
  const missing: string[] = [];

  if (env.COACH_EVAL_LIVE !== "1") missing.push("COACH_EVAL_LIVE=1");
  if (!options.confirmLive) missing.push("--confirm-live");
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!env.OPENAI_MODEL) missing.push("OPENAI_MODEL");

  if (missing.length > 0) {
    throw new EvalGuardError(`Live evaluation not authorized. Missing: ${missing.join(", ")}.`);
  }

  return { model: env.OPENAI_MODEL! };
}

const liveAuthorizations = new WeakSet<object>();

/** Proof that every live gate passed; the runner refuses live mode without one from here. */
export interface LiveAuthorization {
  readonly model: string;
  readonly database: string;
}

export function authorizeLive(model: string, database: string): LiveAuthorization {
  const authorization = Object.freeze({ model, database });
  liveAuthorizations.add(authorization);
  return authorization;
}

export function isLiveAuthorized(value: unknown): value is LiveAuthorization {
  return typeof value === "object" && value !== null && liveAuthorizations.has(value);
}
