// Runs evaluation scenarios against the coach service (ADR-027).
//
// Live mode needs a LiveAuthorization from guards.ts; fake mode needs an
// injected ModelProvider. Before anything else the runner checks the
// connected database is the verified test database and sweeps stale eval
// users. Each scenario gets its own synthetic user, deleted in `finally`.
import prisma from "../../src/lib/prisma.js";
import { COACH_LIMITS } from "../../src/modules/ai/coach.limits.js";
import type { CoachObserverEvent } from "../../src/modules/ai/coach.observer.js";
import { COACH_PROMPT_VERSION } from "../../src/modules/ai/coach.prompts.js";
import { generateCoachResponse, setModelProvider } from "../../src/modules/ai/coach.service.js";
import type { CoachResponse } from "../../src/modules/ai/coach.types.js";
import type { ModelProvider } from "../../src/modules/ai/model.provider.js";
import { BudgetExceededError, type EvalBudget } from "./budget.js";
import { commonTurnChecks } from "./checks.js";
import {
  countEvalUsers,
  createEvalUser,
  deleteEvalUser,
  EVAL_TIME_ZONE,
  EVAL_TODAY,
  FIXTURE_VERSION,
  sweepEvalUsers,
} from "./fixtures.js";
import { checkConnectedDatabase, isLiveAuthorized, type LiveAuthorization } from "./guards.js";
import { buildHistoryForTurn } from "./history.js";
import type { HttpMonitor } from "./http-monitor.js";
import { qualityResult, type Judge } from "./judge.js";
import type { PriorMessage, Scenario, ScenarioOutcome, ScenarioRunRecord, TurnRecord } from "./types.js";

export type EvalMode = { kind: "fake"; provider: ModelProvider } | { kind: "live"; authorization: LiveAuthorization };

export interface RunConfig {
  runId: string;
  mode: EvalMode;
  scenarios: readonly Scenario[];
  repeat: number;
  budget: EvalBudget;
  monitor: HttpMonitor;
  judge?: Judge;
  /** The test database the guards verified, and the development database name(s) it must not be. */
  database: { expected: string; developmentNames: string[] };
  /** The model the run is configured for (OPENAI_MODEL, or the fake provider's). */
  configuredModel: string;
  git?: { head: string | null; dirty: boolean | null };
  log?: (line: string) => void;
  /** Checked between requests; true stops the run cleanly (signals). */
  shouldStop?: () => boolean;
}

export type RunStatus = "completed" | "stopped_budget" | "interrupted" | "error";

export interface EvalReport {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: "live" | "fake";
  model: { configured: string; observed: string[] };
  promptVersion: string;
  fixtureVersion: string;
  today: string;
  git: { head: string | null; dirty: boolean | null };
  config: {
    scenarios: string[];
    repeat: number;
    judge: boolean;
    judgeModel: string | null;
    maxProviderCalls: number;
    maxTotalTokens: number;
    coachLimits: typeof COACH_LIMITS;
  };
  status: RunStatus;
  statusDetail: string;
  cleanup: { staleUsersSwept: number; finalSweep: number; remainingEvalUsers: number };
  totals: {
    runs: number;
    outcomes: Record<ScenarioOutcome, number>;
    requiredDeterministic: { passed: number; total: number };
    requiredHeuristic: { passed: number; total: number };
    providerTurns: number;
    httpAttempts: number;
    observedSdkRetries: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    judgeTokens: number;
    latencyMs: number;
  };
  runs: ScenarioRunRecord[];
}

/** The decision rule; model-judged quality never takes part. */
export function decideOutcome(record: Pick<ScenarioRunRecord, "checks" | "harnessError">): { outcome: ScenarioOutcome; reason: string } {
  if (record.harnessError) return { outcome: "ERROR", reason: `harness error: ${record.harnessError}` };
  const failed = record.checks.filter((check) => !check.pass && check.level === "required");
  const fixtureFailures = failed.filter((check) => check.fixture);
  if (fixtureFailures.length > 0) return { outcome: "ERROR", reason: `fixture check failed: ${fixtureFailures.map((check) => check.id).join(", ")}` };
  const deterministic = failed.filter((check) => check.kind === "deterministic");
  if (deterministic.length > 0) return { outcome: "FAIL", reason: deterministic.map((check) => check.id).join(", ") };
  const heuristic = failed.filter((check) => check.kind === "heuristic");
  if (heuristic.length > 0) return { outcome: "REVIEW", reason: `heuristic: ${heuristic.map((check) => check.id).join(", ")}` };
  return { outcome: "PASS", reason: "all required checks passed" };
}

function emptyTurn(turn: number, message: string): TurnRecord {
  return {
    turn,
    message,
    history: [],
    historyChars: 0,
    response: null,
    sources: null,
    error: null,
    providerTurns: [],
    toolCalls: [],
    completed: null,
    httpAttempts: [],
    latencyMs: 0,
  };
}

function totalsOf(turns: readonly TurnRecord[]): ScenarioRunRecord["totals"] {
  const sum = (pick: (turn: TurnRecord) => number) => turns.reduce((total, turn) => total + pick(turn), 0);
  return {
    providerTurns: sum((turn) => turn.providerTurns.length),
    httpAttempts: sum((turn) => turn.httpAttempts.length),
    observedSdkRetries: sum((turn) => turn.httpAttempts.filter((attempt) => (attempt.sdkRetryCount ?? 0) > 0).length),
    toolCalls: sum((turn) => turn.toolCalls.length),
    inputTokens: sum((turn) => turn.completed?.usage?.inputTokens ?? 0),
    outputTokens: sum((turn) => turn.completed?.usage?.outputTokens ?? 0),
    totalTokens: sum((turn) => turn.completed?.usage?.totalTokens ?? 0),
    latencyMs: sum((turn) => turn.latencyMs),
  };
}

export async function runEvaluation(config: RunConfig): Promise<EvalReport> {
  const log = config.log ?? (() => undefined);
  const startedAt = new Date().toISOString();

  if (config.mode.kind === "live") {
    if (!isLiveAuthorized(config.mode.authorization)) throw new Error("Live evaluation requires an authorization from the live guards.");
    setModelProvider(undefined);
  } else {
    setModelProvider(config.mode.provider);
  }

  try {
    const [{ current_database: connected }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
    checkConnectedDatabase(connected, config.database.expected, config.database.developmentNames);

    const staleUsersSwept = await sweepEvalUsers();
    if (staleUsersSwept > 0) log(`Removed ${staleUsersSwept} stale evaluation user(s) left by an earlier run.`);

    const runs: ScenarioRunRecord[] = [];
    let status: RunStatus = "completed";
    let statusDetail = "";

    outer: for (let repeat = 1; repeat <= config.repeat; repeat += 1) {
      for (const scenario of config.scenarios) {
        if (config.shouldStop?.()) {
          status = "interrupted";
          statusDetail = "Stopped by a signal.";
          break outer;
        }

        const record = await runScenario(scenario, repeat, config);
        runs.push(record);
        log(`${scenario.id} #${repeat}: ${record.outcome} (${record.outcomeReason})`);

        if (record.harnessError?.startsWith("budget:")) {
          status = "stopped_budget";
          statusDetail = record.harnessError.slice("budget: ".length);
          break outer;
        }
      }
    }

    const judgeTokens = runs.reduce((sum, run) => sum + run.judgeTokens, 0);
    const finalSweep = await sweepEvalUsers();
    const remainingEvalUsers = await countEvalUsers();
    const executed = runs.filter((run) => run.outcome !== "SKIPPED");
    const allChecks = executed.flatMap((run) => run.checks).filter((check) => check.level === "required");
    const tally = (kind: "deterministic" | "heuristic") => {
      const relevant = allChecks.filter((check) => check.kind === kind);
      return { passed: relevant.filter((check) => check.pass).length, total: relevant.length };
    };
    const sum = (pick: (run: ScenarioRunRecord) => number) => runs.reduce((total, run) => total + pick(run), 0);
    const outcomes: Record<ScenarioOutcome, number> = { PASS: 0, REVIEW: 0, FAIL: 0, ERROR: 0, SKIPPED: 0 };
    for (const run of runs) outcomes[run.outcome] += 1;

    return {
      schemaVersion: 1,
      runId: config.runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      mode: config.mode.kind,
      model: {
        configured: config.configuredModel,
        observed: [...new Set(runs.flatMap((run) => run.turns.flatMap((turn) => turn.providerTurns.map((providerTurn) => providerTurn.model))))],
      },
      promptVersion: COACH_PROMPT_VERSION,
      fixtureVersion: FIXTURE_VERSION,
      today: EVAL_TODAY,
      git: config.git ?? { head: null, dirty: null },
      config: {
        scenarios: config.scenarios.map((scenario) => scenario.id),
        repeat: config.repeat,
        judge: Boolean(config.judge),
        judgeModel: config.judge?.model ?? null,
        maxProviderCalls: config.budget.maxProviderCalls,
        maxTotalTokens: config.budget.maxTotalTokens,
        coachLimits: COACH_LIMITS,
      },
      status,
      statusDetail,
      cleanup: { staleUsersSwept, finalSweep, remainingEvalUsers },
      totals: {
        runs: runs.length,
        outcomes,
        requiredDeterministic: tally("deterministic"),
        requiredHeuristic: tally("heuristic"),
        providerTurns: sum((run) => run.totals.providerTurns),
        httpAttempts: sum((run) => run.totals.httpAttempts),
        observedSdkRetries: sum((run) => run.totals.observedSdkRetries),
        toolCalls: sum((run) => run.totals.toolCalls),
        inputTokens: sum((run) => run.totals.inputTokens),
        outputTokens: sum((run) => run.totals.outputTokens),
        totalTokens: sum((run) => run.totals.totalTokens),
        judgeTokens,
        latencyMs: sum((run) => run.totals.latencyMs),
      },
      runs,
    };
  } finally {
    setModelProvider(undefined);
  }
}

async function runScenario(scenario: Scenario, repeat: number, config: RunConfig): Promise<ScenarioRunRecord> {
  const record: ScenarioRunRecord = {
    scenarioId: scenario.id,
    title: scenario.title,
    repeat,
    outcome: "ERROR",
    outcomeReason: "",
    turns: [],
    checks: [],
    quality: [],
    totals: totalsOf([]),
    judgeTokens: 0,
  };
  const timeZone = scenario.timeZone ?? EVAL_TIME_ZONE;
  let user: { id: number; email: string } | null = null;

  try {
    user = await createEvalUser(config.runId, scenario.id, repeat);
    await scenario.seed({ userId: user.id });

    const earlier: (PriorMessage | { role: "assistant"; response: CoachResponse })[] = [...(scenario.priorMessages ?? [])];

    for (const [index, message] of scenario.turns.entries()) {
      if (config.shouldStop?.()) break;
      const history = index === 0 && scenario.rawHistory ? scenario.rawHistory : await buildHistoryForTurn(earlier, message);
      const turn = await runTurn(user.id, scenario, index + 1, message, history, timeZone, repeat, config);
      record.turns.push(turn);
      // Like the frontend, only a completed exchange becomes history.
      if (!turn.response) break;
      earlier.push({ role: "user", content: message }, { role: "assistant", response: turn.response });
    }

    record.checks = [...record.turns.flatMap((turn) => commonTurnChecks(turn, EVAL_TODAY)), ...scenario.checks(record.turns)];

    if (config.judge) {
      for (const turn of record.turns.filter((candidate) => candidate.response)) {
        try {
          config.budget.reserve(1, `judging ${scenario.id} turn ${turn.turn}`);
          config.monitor.phase = `judge ${scenario.id}#${repeat} turn ${turn.turn}`;
          const before = config.monitor.attempts.length;
          const { scores, totalTokens } = await config.judge.score({ scenario, turn, today: EVAL_TODAY });
          config.budget.record(Math.max(1, config.monitor.attempts.length - before), totalTokens);
          record.judgeTokens += totalTokens;
          record.quality.push(qualityResult(config.judge, turn.turn, scores));
        } catch (error) {
          if (error instanceof BudgetExceededError) throw error;
          (record.qualityErrors ??= []).push(`turn ${turn.turn}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  } catch (error) {
    record.harnessError =
      error instanceof BudgetExceededError ? `budget: ${error.message}` : error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally {
    if (user) await deleteEvalUser(user);
  }

  record.totals = totalsOf(record.turns);
  const decided = decideOutcome(record);
  record.outcome = record.harnessError?.startsWith("budget:") && record.turns.length === 0 ? "SKIPPED" : decided.outcome;
  record.outcomeReason = decided.reason;
  return record;
}

async function runTurn(
  userId: number,
  scenario: Scenario,
  turnNumber: number,
  message: string,
  history: TurnRecord["history"],
  timeZone: string,
  repeat: number,
  config: RunConfig
): Promise<TurnRecord> {
  const record = emptyTurn(turnNumber, message);
  record.history = history;
  record.historyChars = history.reduce((sum, turn) => sum + turn.content.length, 0);

  // Worst case for one request: every permitted provider call.
  config.budget.reserve(COACH_LIMITS.maxModelTurns, `${scenario.id} #${repeat} turn ${turnNumber}`);
  config.monitor.phase = `${scenario.id}#${repeat} turn ${turnNumber}`;
  const attemptsBefore = config.monitor.attempts.length;

  const observer = (event: CoachObserverEvent) => {
    if (event.type === "provider_turn") {
      const { type: _type, requestId: _requestId, ...rest } = event;
      record.providerTurns.push(rest);
    } else if (event.type === "tool_call") {
      const { type: _type, requestId: _requestId, ...rest } = event;
      record.toolCalls.push(rest);
    } else {
      record.completed = event;
    }
  };

  const startedAt = Date.now();
  try {
    const result = await generateCoachResponse(
      userId,
      { message, clientContext: { today: EVAL_TODAY, timeZone }, history },
      { limits: scenario.limits, observer }
    );
    record.response = result.response;
    record.sources = result.sources;
  } catch (error) {
    record.error = { name: error instanceof Error ? error.name : "Error", failureCategory: record.completed?.failureCategory ?? null };
  } finally {
    record.latencyMs = Date.now() - startedAt;
    record.httpAttempts = config.monitor.attempts.slice(attemptsBefore);
    config.budget.record(Math.max(record.providerTurns.length, record.httpAttempts.length), record.completed?.usage?.totalTokens ?? 0);
  }

  return record;
}
