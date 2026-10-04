// Emergency spending ceilings for one evaluation run. Before every request the
// runner reserves that request's worst case, so a run stops cleanly before a
// ceiling could be crossed rather than after.

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface BudgetSnapshot {
  providerCalls: number;
  totalTokens: number;
  maxProviderCalls: number;
  maxTotalTokens: number;
}

/** Tokens reserved for a request before any has been measured. */
export const INITIAL_TOKEN_RESERVATION = 60_000;

export class EvalBudget {
  private providerCalls = 0;
  private totalTokens = 0;
  private largestRequestTokens = 0;

  constructor(
    readonly maxProviderCalls: number,
    readonly maxTotalTokens: number
  ) {}

  /** Worst-case tokens for the next request: twice the largest seen so far, at least the initial reservation. */
  tokenReservation(): number {
    return Math.max(INITIAL_TOKEN_RESERVATION, this.largestRequestTokens * 2);
  }

  /** Throws when a request that could make `providerCalls` calls might cross a ceiling. */
  reserve(providerCalls: number, label: string): void {
    if (this.providerCalls + providerCalls > this.maxProviderCalls) {
      throw new BudgetExceededError(
        `Stopping before ${label}: it could make ${providerCalls} provider calls, and ${this.providerCalls} of the ${this.maxProviderCalls} allowed are used.`
      );
    }
    if (this.totalTokens + this.tokenReservation() > this.maxTotalTokens) {
      throw new BudgetExceededError(
        `Stopping before ${label}: ${this.totalTokens} of ${this.maxTotalTokens} tokens are used and the next request may need ${this.tokenReservation()}.`
      );
    }
  }

  record(providerCalls: number, tokens: number): void {
    this.providerCalls += providerCalls;
    this.totalTokens += tokens;
    this.largestRequestTokens = Math.max(this.largestRequestTokens, tokens);
  }

  snapshot(): BudgetSnapshot {
    return {
      providerCalls: this.providerCalls,
      totalTokens: this.totalTokens,
      maxProviderCalls: this.maxProviderCalls,
      maxTotalTokens: this.maxTotalTokens,
    };
  }
}
