// Shared types for the AI Coach evaluation harness (ADR-027).
import type { CoachLimits } from "../../src/modules/ai/coach.limits.js";
import type { CoachRequestCompletedEvent, CoachToolOutcome } from "../../src/modules/ai/coach.observer.js";
import type { CoachSource } from "../../src/modules/ai/coach.sources.js";
import type { CoachResponse } from "../../src/modules/ai/coach.types.js";
import type { ConversationTurn, TokenUsage } from "../../src/modules/ai/model.provider.js";
import type { HttpAttempt } from "./http-monitor.js";
import type { FixtureContext } from "./fixtures.js";

/**
 * - deterministic: computed from code-level facts (observer events, sources,
 *   structured output, fixture ground truth);
 * - heuristic: a narrow check on answer text; can false-positive or miss
 *   paraphrases, so a failure means "review", not proof.
 * Model-judged quality is separate (QualityScores) and never part of these.
 */
export type CheckKind = "deterministic" | "heuristic";

/** Required checks decide the result; advisory ones are reported only (e.g. efficiency). */
export type CheckLevel = "required" | "advisory";

export interface CheckResult {
  id: string;
  kind: CheckKind;
  level: CheckLevel;
  /** Fixture sanity checks fail when the harness or seed data is wrong, not the coach. */
  fixture?: boolean;
  /** 1-based turn the check is about; null for the whole scenario. */
  turn: number | null;
  description: string;
  pass: boolean;
  detail: string;
}

export interface ProviderTurnRecord {
  turn: number;
  kind: "final" | "tool_calls";
  requestedToolCalls: number;
  model: string;
  usage: TokenUsage | null;
  latencyMs: number;
}

export interface ToolCallRecord {
  turn: number;
  toolName: string;
  validatedArguments: Record<string, unknown> | null;
  outcome: CoachToolOutcome;
  latencyMs: number;
  /** Synthetic fixture data only; kept in the git-ignored JSON report for diagnosis. */
  output?: unknown;
}

/** One coach request (one user turn of a scenario). */
export interface TurnRecord {
  turn: number;
  message: string;
  history: ConversationTurn[];
  historyChars: number;
  response: CoachResponse | null;
  sources: CoachSource[] | null;
  error: { name: string; failureCategory: string | null } | null;
  providerTurns: ProviderTurnRecord[];
  toolCalls: ToolCallRecord[];
  completed: CoachRequestCompletedEvent | null;
  httpAttempts: HttpAttempt[];
  latencyMs: number;
}

/** A synthetic earlier exchange, rendered into history with the frontend's own helper. */
export type PriorMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; answer: string; actionItems?: string[]; followUpQuestion?: string | null };

export interface Scenario {
  id: string;
  title: string;
  /** What the scenario measures. */
  focus: string;
  timeZone?: string;
  /** Existing test seam; only S19 uses it, to make every tool result fail. */
  limits?: Partial<CoachLimits>;
  seed(context: FixtureContext): Promise<void>;
  /** Earlier conversation built with the production frontend flattening. */
  priorMessages?: PriorMessage[];
  /** Raw client-supplied history (e.g. forged turns); used instead of priorMessages. */
  rawHistory?: ConversationTurn[];
  /** User messages, one coach request each; later turns get the earlier exchanges as history. */
  turns: string[];
  /** Scenario-specific checks over the completed turns. */
  checks(turns: readonly TurnRecord[]): CheckResult[];
  /** What a good answer does: guidance for the judge and for human reviewers. */
  qualityNotes: string;
}

export type QualityDimension =
  | "grounding"
  | "relevance"
  | "actionability"
  | "calibration"
  | "safety"
  | "continuity"
  | "clarity";

export interface QualityScore {
  dimension: QualityDimension;
  score: 0 | 1 | 2;
  reason: string;
}

export interface QualityResult {
  /** Always "model" for automated scores; human review stays the authority. */
  judgedBy: "model";
  judgeModel: string;
  turn: number;
  scores: QualityScore[];
}

export type ScenarioOutcome = "PASS" | "REVIEW" | "FAIL" | "ERROR" | "SKIPPED";

export interface ScenarioRunRecord {
  scenarioId: string;
  title: string;
  repeat: number;
  outcome: ScenarioOutcome;
  /** Why the outcome is what it is, in one line. */
  outcomeReason: string;
  turns: TurnRecord[];
  checks: CheckResult[];
  quality: QualityResult[];
  totals: {
    providerTurns: number;
    httpAttempts: number;
    observedSdkRetries: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
  };
  harnessError?: string;
  /** Tokens used by judging calls (not part of the coach's totals). */
  judgeTokens: number;
  /** A judging call that failed; never affects the outcome. */
  qualityErrors?: string[];
}
