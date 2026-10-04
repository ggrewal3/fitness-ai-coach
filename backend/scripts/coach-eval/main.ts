// Live AI Coach evaluation (ADR-027). Opt-in only; see docs/DEVELOPMENT.md.
//
//   COACH_EVAL_LIVE=1 TEST_DATABASE_URL=… npm run eval:coach -- --scenarios=S1,S15 --confirm-live
//   TEST_DATABASE_URL=… npm run eval:coach -- --dry-run          # print the plan only
//
// Order matters: every gate runs, and DATABASE_URL is pointed at the verified
// test database, before any module that creates the Prisma client or the
// model provider is imported.
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { COACH_LIMITS, PROVIDER_MAX_RETRIES } from "../../src/modules/ai/coach.limits.js";
import {
  authorizeLive,
  checkDatabaseIsolation,
  checkLiveOptIn,
  databaseIdentity,
  EvalGuardError,
  parseEvalArgs,
} from "./guards.js";

// Read the development .env without loading it into this process, and never print it.
const developmentEnv: Record<string, string> = {};
dotenv.config({ processEnv: developmentEnv, quiet: true });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function git(args: string[]): string | null {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Recorded in the report so a run can be tied to the code it measured. */
function gitState(): { head: string | null; dirty: boolean | null } {
  const status = git(["status", "--porcelain"]);
  return { head: git(["rev-parse", "--short", "HEAD"]), dirty: status === null ? null : status !== "" };
}

try {
  const options = parseEvalArgs(process.argv.slice(2));
  const testUrl = process.env.TEST_DATABASE_URL;
  const { database } = checkDatabaseIsolation(testUrl, [process.env.DATABASE_URL, developmentEnv.DATABASE_URL]);
  const developmentNames = [process.env.DATABASE_URL, developmentEnv.DATABASE_URL]
    .map((url) => (url ? databaseIdentity(url)?.database : undefined))
    .filter((name): name is string => Boolean(name));

  // From here on every database access goes to the verified test database.
  process.env.DATABASE_URL = testUrl;

  const { selectScenarios, requestCount } = await import("./scenarios.js");
  const scenarios = selectScenarios(options.scenarios);
  const requests = requestCount(scenarios) * options.repeat;
  const maxCoachCalls = requests * COACH_LIMITS.maxModelTurns;
  const maxJudgeCalls = options.judge ? requests : 0;
  const maxCalls = maxCoachCalls + maxJudgeCalls;
  // OPENAI_* may come from the shell or backend/.env; COACH_EVAL_LIVE only from the shell.
  const providerEnv = {
    COACH_EVAL_LIVE: process.env.COACH_EVAL_LIVE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? developmentEnv.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? developmentEnv.OPENAI_MODEL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? developmentEnv.OPENAI_BASE_URL,
    COACH_EVAL_JUDGE_MODEL: process.env.COACH_EVAL_JUDGE_MODEL,
  };

  console.log(
    [
      "AI Coach live evaluation plan",
      `  model:           ${providerEnv.OPENAI_MODEL ?? "(OPENAI_MODEL not set)"}`,
      `  judge:           ${options.judge ? (providerEnv.COACH_EVAL_JUDGE_MODEL || providerEnv.OPENAI_MODEL) : "off"}`,
      `  scenarios:       ${scenarios.map((scenario) => scenario.id).join(", ")}`,
      `  repeat:          ${options.repeat}`,
      `  coach requests:  ${requests}`,
      `  max provider calls: ${maxCalls} (${maxCoachCalls} coach${options.judge ? ` + ${maxJudgeCalls} judge` : ""}); HTTP attempts at most ${maxCalls * (1 + PROVIDER_MAX_RETRIES)} with SDK retries`,
      `  ceilings:        ${options.maxProviderCalls} provider calls / HTTP attempts, ${options.maxTotalTokens.toLocaleString("en-US")} tokens`,
      `  database:        ${database} (verified test database)`,
    ].join("\n")
  );
  if (maxCalls > options.maxProviderCalls) {
    console.log(`  note: the plan could exceed the ${options.maxProviderCalls}-call ceiling; the run would stop cleanly before crossing it.`);
  }

  if (options.dryRun) {
    console.log("Dry run: nothing was connected to and no provider was called.");
    process.exit(0);
  }

  const { model } = checkLiveOptIn(providerEnv, options);
  const authorization = authorizeLive(model, database);

  // Bring the test database to the current schema and built-in catalogue (as the test runner does).
  for (const args of [["prisma", "migrate", "deploy"], ["prisma", "db", "seed"]]) {
    const result = spawnSync("npx", args, { stdio: "inherit", env: { ...process.env, DATABASE_URL: testUrl } });
    if (result.status !== 0) fail(`npx ${args.join(" ")} failed.`);
  }

  const { installHttpMonitor, providerHostsFromEnv } = await import("./http-monitor.js");
  // Before the coach creates its provider: the SDK captures fetch at construction.
  const monitor = installHttpMonitor({ providerHosts: providerHostsFromEnv(providerEnv), maxAttempts: options.maxProviderCalls });

  const { EvalBudget } = await import("./budget.js");
  const { newRunId, sweepEvalUsers } = await import("./fixtures.js");
  const { runEvaluation } = await import("./runner.js");
  const { writeReport } = await import("./report.js");
  const { createOpenAIJudge } = await import("./judge.js");

  let stopping = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.error(`\n${signal}: removing evaluation users before exiting…`);
    sweepEvalUsers()
      .then((count) => console.error(`Removed ${count} evaluation user(s).`))
      .catch((error: unknown) => console.error(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}. Run the evaluation again (it sweeps stale users at start).`))
      .finally(() => process.exit(130));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const runId = newRunId();
  const report = await runEvaluation({
    runId,
    mode: { kind: "live", authorization },
    scenarios,
    repeat: options.repeat,
    budget: new EvalBudget(options.maxProviderCalls, options.maxTotalTokens),
    monitor,
    judge: options.judge ? createOpenAIJudge(providerEnv) : undefined,
    database: { expected: database, developmentNames },
    configuredModel: model,
    git: gitState(),
    log: (line) => console.log(line),
    shouldStop: () => stopping,
  });
  monitor.uninstall();

  const paths = await writeReport(report);
  const { totals } = report;
  console.log(
    [
      "",
      `Run ${report.runId}: ${report.status}${report.statusDetail ? ` (${report.statusDetail})` : ""}`,
      `  outcomes: ${Object.entries(totals.outcomes).filter(([, count]) => count > 0).map(([outcome, count]) => `${outcome} ${count}`).join(", ")}`,
      `  provider calls ${totals.providerTurns}, HTTP attempts ${totals.httpAttempts}, tokens ${totals.totalTokens + totals.judgeTokens}`,
      `  eval users remaining: ${report.cleanup.remainingEvalUsers}`,
      `  report: ${paths.markdown}`,
      `          ${paths.json}`,
    ].join("\n")
  );

  const { default: prisma } = await import("../../src/lib/prisma.js");
  await prisma.$disconnect();
  process.exit(report.status === "completed" && report.cleanup.remainingEvalUsers === 0 ? 0 : 1);
} catch (error) {
  if (error instanceof EvalGuardError) fail(error.message);
  fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
}
