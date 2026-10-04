// Per-run reports: a complete JSON record and a readable Markdown summary,
// written to the git-ignored results directory. Reports contain synthetic
// fixture data and metadata only, never credentials or connection strings.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { toolSummary } from "./checks.js";
import type { EvalReport } from "./runner.js";
import type { CheckResult, ScenarioRunRecord } from "./types.js";

export const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

const pct = (passed: number, total: number) => (total === 0 ? "n/a" : `${passed}/${total} (${Math.round((passed / total) * 100)}%)`);
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n+/g, " ");

function checkCounts(run: ScenarioRunRecord, kind: CheckResult["kind"]): string {
  const relevant = run.checks.filter((check) => check.kind === kind && check.level === "required");
  return `${relevant.filter((check) => check.pass).length}/${relevant.length}`;
}

function qualityAverage(run: ScenarioRunRecord): string {
  const scores = run.quality.flatMap((result) => result.scores.map((score) => score.score));
  return scores.length === 0 ? "–" : (scores.reduce<number>((sum, score) => sum + score, 0) / scores.length).toFixed(2);
}

export function renderMarkdown(report: EvalReport): string {
  const { totals } = report;
  const lines: string[] = [
    `# AI Coach evaluation ${report.runId}`,
    "",
    `- **Mode:** ${report.mode}${report.mode === "fake" ? " (scripted provider; not a model evaluation)" : ""}`,
    `- **Model:** configured \`${report.model.configured}\`; observed ${report.model.observed.map((model) => `\`${model}\``).join(", ") || "none"}`,
    `- **Prompt:** \`${report.promptVersion}\` · **Fixtures:** \`${report.fixtureVersion}\` (today ${report.today}) · **Git:** ${report.git.head ?? "unknown"}${report.git.dirty ? " (uncommitted changes)" : ""}`,
    `- **Run:** ${report.startedAt} → ${report.finishedAt} · status **${report.status}**${report.statusDetail ? ` (${report.statusDetail})` : ""}`,
    `- **Config:** scenarios ${report.config.scenarios.join(", ")} · repeat ${report.config.repeat} · judge ${report.config.judge ? `on (\`${report.config.judgeModel}\`)` : "off"} · ceilings ${report.config.maxProviderCalls} provider calls / ${report.config.maxTotalTokens.toLocaleString("en-US")} tokens`,
    `- **Cleanup:** ${report.cleanup.staleUsersSwept} stale eval users removed at start, ${report.cleanup.finalSweep} at the end, **${report.cleanup.remainingEvalUsers} remaining**`,
    "",
    "## Summary",
    "",
    `- Outcomes: ${Object.entries(totals.outcomes).filter(([, count]) => count > 0).map(([outcome, count]) => `${outcome} ${count}`).join(" · ")} (of ${totals.runs} runs)`,
    `- Required deterministic checks: ${pct(totals.requiredDeterministic.passed, totals.requiredDeterministic.total)}`,
    `- Required heuristic checks: ${pct(totals.requiredHeuristic.passed, totals.requiredHeuristic.total)} (text heuristics: a failure means review)`,
    `- Provider calls ${totals.providerTurns} · HTTP attempts ${totals.httpAttempts} · observed SDK retries ${totals.observedSdkRetries} · tool calls ${totals.toolCalls}`,
    `- Coach tokens: ${totals.inputTokens.toLocaleString("en-US")} in / ${totals.outputTokens.toLocaleString("en-US")} out / ${totals.totalTokens.toLocaleString("en-US")} total · judge tokens ${totals.judgeTokens.toLocaleString("en-US")} · coach latency ${(totals.latencyMs / 1000).toFixed(1)} s`,
    "",
    "Outcome rule: **ERROR** harness or fixture problem · **FAIL** a required deterministic check failed · **REVIEW** only a heuristic text check failed · **PASS** otherwise. Model-judged quality never changes the outcome.",
    "",
    "| Scenario | # | Outcome | Det. | Heur. | Provider calls | HTTP (retries) | Tools | Tokens in/out | Latency | Quality (model) |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];

  for (const run of report.runs) {
    lines.push(
      `| ${run.scenarioId} ${cell(run.title)} | ${run.repeat} | **${run.outcome}** | ${checkCounts(run, "deterministic")} | ${checkCounts(run, "heuristic")} | ${run.totals.providerTurns} | ${run.totals.httpAttempts} (${run.totals.observedSdkRetries}) | ${cell(run.turns.map(toolSummary).join(" / "))} | ${run.totals.inputTokens}/${run.totals.outputTokens} | ${run.totals.latencyMs} ms | ${qualityAverage(run)} |`
    );
  }

  lines.push("", "## Details", "");

  for (const run of report.runs) {
    lines.push(`### ${run.scenarioId} #${run.repeat}: ${run.title} — ${run.outcome}`, "", `${run.outcomeReason}`, "");
    if (run.harnessError) lines.push(`- Harness error: ${run.harnessError}`, "");

    const failed = run.checks.filter((check) => !check.pass);
    if (failed.length > 0) {
      lines.push("Failed checks:", "");
      for (const check of failed) {
        lines.push(`- \`${check.id}\` (${check.kind}, ${check.level}${check.fixture ? ", fixture" : ""}${check.turn ? `, turn ${check.turn}` : ""}): ${check.description}${check.detail ? ` — ${check.detail}` : ""}`);
      }
      lines.push("");
    }

    for (const turn of run.turns) {
      lines.push(`**Turn ${turn.turn}:** ${turn.message}`, "");
      lines.push(`- History: ${turn.history.length} turns, ${turn.historyChars} chars`);
      lines.push(`- Tools: ${toolSummary(turn)}`);
      lines.push(`- Provider calls: ${turn.providerTurns.map((call) => `${call.kind} ${call.latencyMs} ms`).join(", ") || "none"}`);
      if (turn.httpAttempts.length > 0) {
        lines.push(`- HTTP attempts: ${turn.httpAttempts.map((attempt) => `${attempt.status ?? "error"} ${attempt.latencyMs} ms${attempt.sdkRetryCount ? ` (retry ${attempt.sdkRetryCount})` : ""}`).join(", ")}`);
      }
      lines.push(`- Sources: ${turn.sources ? JSON.stringify(turn.sources) : "–"}`);
      if (turn.error) lines.push(`- **Error:** ${turn.error.name} (${turn.error.failureCategory ?? "uncategorised"})`);
      if (turn.response) {
        lines.push("", "> " + turn.response.answer.replace(/\n/g, "\n> "));
        if (turn.response.actionItems.length > 0) lines.push(">", "> Action items:", ...turn.response.actionItems.map((item) => `> - ${item}`));
        if (turn.response.followUpQuestion) lines.push(">", `> Follow-up: ${turn.response.followUpQuestion}`);
      }
      lines.push("");
    }

    if (run.quality.length > 0) {
      lines.push("Quality (model-judged, advisory; human review decides safety and doubtful scores):", "");
      for (const result of run.quality) {
        lines.push(`- Turn ${result.turn} by \`${result.judgeModel}\`: ${result.scores.map((score) => `${score.dimension} ${score.score} (${score.reason})`).join("; ")}`);
      }
      lines.push("");
    }
    if (run.qualityErrors?.length) lines.push(`Judge errors: ${run.qualityErrors.join("; ")}`, "");
  }

  return `${lines.join("\n")}\n`;
}

export async function writeReport(report: EvalReport, directory = RESULTS_DIR): Promise<{ json: string; markdown: string }> {
  await mkdir(directory, { recursive: true });
  const json = `${directory}/${report.runId}.json`;
  const markdown = `${directory}/${report.runId}.md`;
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdown, renderMarkdown(report));
  return { json, markdown };
}
