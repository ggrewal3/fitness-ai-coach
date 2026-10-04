// Compares a baseline and a candidate evaluation report (1D-C).
//
//   npm run eval:coach:compare -- <baseline.json> <candidate.json> [--allow-model-change]
//
// A comparison is valid only between live runs with the same fixtures,
// scenarios, repeat count and model. A different model is refused unless
// --allow-model-change marks it as a model-change experiment.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { EvalReport } from "./runner.js";
import type { QualityDimension, ScenarioOutcome } from "./types.js";

const RANK: Record<ScenarioOutcome, number> = { PASS: 3, REVIEW: 2, FAIL: 1, ERROR: 0, SKIPPED: -1 };

export interface ScenarioComparison {
  scenarioId: string;
  baseline: string;
  candidate: string;
  change: "improved" | "regressed" | "same" | "missing";
}

export interface Comparison {
  valid: boolean;
  modelChange: boolean;
  problems: string[];
  notes: string[];
  scenarios: ScenarioComparison[];
  metrics: { name: string; baseline: number; candidate: number }[];
  quality: { dimension: QualityDimension; baseline: number | null; candidate: number | null }[];
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

function outcomesFor(report: EvalReport, scenarioId: string): ScenarioOutcome[] {
  return report.runs.filter((run) => run.scenarioId === scenarioId).map((run) => run.outcome);
}

/** The worst outcome across repeats decides regressions; the counts are shown alongside. */
function summarize(outcomes: ScenarioOutcome[]): { label: string; worst: number } {
  if (outcomes.length === 0) return { label: "–", worst: Number.NaN };
  const counts = outcomes.reduce<Record<string, number>>((all, outcome) => ({ ...all, [outcome]: (all[outcome] ?? 0) + 1 }), {});
  return {
    label: Object.entries(counts).map(([outcome, count]) => (outcomes.length === 1 ? outcome : `${outcome} ${count}/${outcomes.length}`)).join(", "),
    worst: Math.min(...outcomes.map((outcome) => RANK[outcome])),
  };
}

function averageQuality(report: EvalReport, dimension: QualityDimension): number | null {
  const scores = report.runs.flatMap((run) => run.quality.flatMap((result) => result.scores.filter((score) => score.dimension === dimension).map((score) => score.score)));
  return scores.length === 0 ? null : Number((scores.reduce<number>((sum, score) => sum + score, 0) / scores.length).toFixed(2));
}

export function compareReports(baseline: EvalReport, candidate: EvalReport, options: { allowModelChange?: boolean } = {}): Comparison {
  const problems: string[] = [];
  const notes: string[] = [];

  if (baseline.mode !== "live" || candidate.mode !== "live") problems.push("Both reports must be live runs (fake-provider runs test the harness, not the coach).");
  if (baseline.fixtureVersion !== candidate.fixtureVersion || baseline.today !== candidate.today) problems.push("Fixture versions or dates differ.");
  if (!sameList(baseline.config.scenarios, candidate.config.scenarios)) problems.push("The scenario sets differ.");
  if (baseline.config.repeat !== candidate.config.repeat) problems.push("The repeat counts differ.");
  if (baseline.status !== "completed" || candidate.status !== "completed") problems.push("A run did not complete (budget stop, interruption or error).");

  const baselineModels = [baseline.model.configured, ...baseline.model.observed];
  const candidateModels = [candidate.model.configured, ...candidate.model.observed];
  const modelChange = baseline.model.configured !== candidate.model.configured || !sameList([...new Set(baselineModels)].sort(), [...new Set(candidateModels)].sort());
  if (modelChange && !options.allowModelChange) {
    problems.push(`Different models (${baseline.model.configured} vs ${candidate.model.configured}); rerun with the same model, or pass --allow-model-change to mark a model-change experiment.`);
  }
  if (modelChange && options.allowModelChange) notes.push("MODEL-CHANGE EXPERIMENT: differences may come from the model, not the coach.");
  if (baseline.promptVersion !== candidate.promptVersion) notes.push(`Prompt ${baseline.promptVersion} → ${candidate.promptVersion}.`);
  if (baseline.config.judge !== candidate.config.judge || baseline.config.judgeModel !== candidate.config.judgeModel) {
    notes.push("Judge settings differ: quality scores are not comparable.");
  }

  const ids = [...new Set([...baseline.config.scenarios, ...candidate.config.scenarios])];
  const scenarios = ids.map((scenarioId): ScenarioComparison => {
    const before = summarize(outcomesFor(baseline, scenarioId));
    const after = summarize(outcomesFor(candidate, scenarioId));
    const change = Number.isNaN(before.worst) || Number.isNaN(after.worst) ? "missing" : after.worst > before.worst ? "improved" : after.worst < before.worst ? "regressed" : "same";
    return { scenarioId, baseline: before.label, candidate: after.label, change };
  });

  const metric = (name: string, pick: (report: EvalReport) => number) => ({ name, baseline: pick(baseline), candidate: pick(candidate) });
  const rate = (pair: { passed: number; total: number }) => (pair.total === 0 ? 0 : Number(((pair.passed / pair.total) * 100).toFixed(1)));
  const perRun = (report: EvalReport, value: number) => (report.totals.runs === 0 ? 0 : Number((value / report.totals.runs).toFixed(1)));

  const metrics = [
    metric("PASS runs", (report) => report.totals.outcomes.PASS),
    metric("Required deterministic pass %", (report) => rate(report.totals.requiredDeterministic)),
    metric("Required heuristic pass %", (report) => rate(report.totals.requiredHeuristic)),
    metric("Provider calls per run", (report) => perRun(report, report.totals.providerTurns)),
    metric("Tool calls per run", (report) => perRun(report, report.totals.toolCalls)),
    metric("Tokens per run", (report) => perRun(report, report.totals.totalTokens)),
    metric("Latency per run (ms)", (report) => perRun(report, report.totals.latencyMs)),
  ];

  const dimensions: QualityDimension[] = ["grounding", "relevance", "actionability", "calibration", "safety", "continuity", "clarity"];
  const quality = dimensions.map((dimension) => ({ dimension, baseline: averageQuality(baseline, dimension), candidate: averageQuality(candidate, dimension) }));

  return { valid: problems.length === 0, modelChange, problems, notes, scenarios, metrics, quality };
}

export function renderComparison(baseline: EvalReport, candidate: EvalReport, comparison: Comparison): string {
  const lines = [
    `# Coach evaluation comparison: ${baseline.runId} → ${candidate.runId}`,
    "",
    `- Baseline: \`${baseline.promptVersion}\` on \`${baseline.model.configured}\`; candidate: \`${candidate.promptVersion}\` on \`${candidate.model.configured}\``,
    `- Validity: **${comparison.valid ? "valid" : "INVALID"}**`,
    ...comparison.problems.map((problem) => `- Problem: ${problem}`),
    ...comparison.notes.map((note) => `- Note: ${note}`),
    "",
    "| Scenario | Baseline | Candidate | Change |",
    "|---|---|---|---|",
    ...comparison.scenarios.map((row) => `| ${row.scenarioId} | ${row.baseline} | ${row.candidate} | ${row.change === "regressed" ? "**regressed**" : row.change} |`),
    "",
    "| Metric | Baseline | Candidate |",
    "|---|---|---|",
    ...comparison.metrics.map((row) => `| ${row.name} | ${row.baseline} | ${row.candidate} |`),
  ];
  if (comparison.quality.some((row) => row.baseline !== null || row.candidate !== null)) {
    lines.push("", "| Quality (model-judged average, 0–2) | Baseline | Candidate |", "|---|---|---|");
    lines.push(...comparison.quality.map((row) => `| ${row.dimension} | ${row.baseline ?? "–"} | ${row.candidate ?? "–"} |`));
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv: string[]): Promise<number> {
  const allowModelChange = argv.includes("--allow-model-change");
  const files = argv.filter((arg) => !arg.startsWith("--"));
  if (files.length !== 2) {
    console.error("Usage: npm run eval:coach:compare -- <baseline.json> <candidate.json> [--allow-model-change]");
    return 2;
  }
  const [baseline, candidate] = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8")) as EvalReport));
  const comparison = compareReports(baseline, candidate, { allowModelChange });
  console.log(renderComparison(baseline, candidate, comparison));
  return comparison.valid ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
