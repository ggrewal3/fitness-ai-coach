// Counts outgoing model-provider HTTP attempts in the evaluation process only.
//
// The OpenAI SDK captures `fetch` when its client is constructed and the coach
// creates its provider lazily, so installing this before the first coach
// request covers every attempt, including SDK retries. Production code is not
// touched. Only the URL host, status, timing and the SDK's own retry-count
// header are read: never request or response bodies, never auth headers.

export interface HttpAttempt {
  /** Which part of the run made the call (coach request or judge). */
  phase: string;
  startedAt: number;
  latencyMs: number;
  status: number | null;
  /** The SDK's `X-Stainless-Retry-Count` request header; 0 for a first attempt, null if absent. */
  sdkRetryCount: number | null;
}

export class HttpAttemptLimitError extends Error {
  constructor(limit: number) {
    super(`Model-provider HTTP attempt ceiling (${limit}) reached; request blocked before sending.`);
    this.name = "HttpAttemptLimitError";
  }
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => String(key).toLowerCase() === name);
    return found ? String(found[1]) : null;
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name) return String(value);
  }
  return null;
}

export interface HttpMonitor {
  readonly attempts: readonly HttpAttempt[];
  phase: string;
  uninstall(): void;
}

/**
 * Wraps `globalThis.fetch`. Requests to `providerHosts` are counted (and
 * refused past `maxAttempts`); requests to any other host are refused when
 * `blockOtherHosts` is set (self-tests use this to prove no live call leaves).
 */
export function installHttpMonitor(options: {
  providerHosts: readonly string[];
  maxAttempts: number;
  blockOtherHosts?: { allow: readonly string[] };
}): HttpMonitor {
  const original = globalThis.fetch;
  const attempts: HttpAttempt[] = [];
  const monitor: HttpMonitor = {
    attempts,
    phase: "setup",
    uninstall: () => {
      globalThis.fetch = original;
    },
  };

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (!options.providerHosts.includes(url.hostname)) {
      if (options.blockOtherHosts && !options.blockOtherHosts.allow.includes(url.hostname)) {
        throw new Error(`Blocked network request to ${url.hostname} during an offline evaluation.`);
      }
      return original(input, init);
    }

    if (attempts.length >= options.maxAttempts) {
      throw new HttpAttemptLimitError(options.maxAttempts);
    }

    const retryHeader = headerValue(init?.headers ?? (input instanceof Request ? input.headers : undefined), "x-stainless-retry-count");
    const attempt: HttpAttempt = {
      phase: monitor.phase,
      startedAt: Date.now(),
      latencyMs: 0,
      status: null,
      sdkRetryCount: retryHeader !== null && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null,
    };
    attempts.push(attempt);

    try {
      const response = await original(input, init);
      attempt.status = response.status;
      return response;
    } finally {
      attempt.latencyMs = Date.now() - attempt.startedAt;
    }
  };

  return monitor;
}

/** The provider host the SDK will call: OPENAI_BASE_URL's host, else api.openai.com. */
export function providerHostsFromEnv(env: Record<string, string | undefined>): string[] {
  if (env.OPENAI_BASE_URL) {
    try {
      return [new URL(env.OPENAI_BASE_URL).hostname];
    } catch {
      // Fall through to the default; the SDK would fail on an invalid URL anyway.
    }
  }
  return ["api.openai.com"];
}
