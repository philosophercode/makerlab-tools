import { listPriceUsd, totalUsage, type CallUsage, type ChipSetReport } from "./refresh.ts";

/**
 * The starter refresh's report (starter answers): the JSON the script writes,
 * and a readable Markdown summary of it — old and new questions, grades, and
 * a sample answer or two. Pure.
 */

export interface RefreshRunReport {
  startedAt: string;
  finishedAt: string;
  target: string;
  apply: boolean;
  models: { chat: string; grade: string; write: string };
  estimateUsd: number;
  chipSets: ChipSetReport[];
  totals: ReturnType<typeof totalUsage> & { listPriceUsd: number };
}

export function buildRunReport(input: Omit<RefreshRunReport, "totals" | "finishedAt"> & { finishedAt?: string }): RefreshRunReport {
  const totals = totalUsage(input.chipSets);
  return { ...input, finishedAt: input.finishedAt ?? new Date().toISOString(), totals: { ...totals, listPriceUsd: listPriceUsd(totals.all) } };
}

function money(usage: CallUsage): string {
  return usage.gatewayCost === null ? `~$${listPriceUsd(usage).toFixed(4)} at list price` : `$${usage.gatewayCost.toFixed(4)} reported`;
}

/** One line a chip set ends with in the console. */
export function chipSetLine(report: ChipSetReport): string {
  const accepted = report.chips.filter((c) => c.accepted).length;
  return `  ${report.name}: ${accepted}/${report.chips.length} answers accepted, ${report.changed ? "questions changed" : "questions kept"}, ${report.cached} cacheable — ${report.write.replace(/_/g, " ")}${report.error ? ` (${report.error})` : ""}`;
}

export function runSummaryLines(run: RefreshRunReport): string[] {
  const sets = run.chipSets;
  const chips = sets.flatMap((s) => s.chips);
  return [
    `${sets.length} chip set(s), ${chips.length} question(s) asked, ${chips.filter((c) => c.accepted).length} accepted; ${sets.filter((s) => s.changed).length} set(s) with new questions; ${sets.reduce((n, s) => n + s.cached, 0)} answer(s) ${run.apply ? "cached" : "cacheable"}.`,
    `Tokens: answers ${run.totals.answer.inputTokens} in / ${run.totals.answer.outputTokens} out (${money(run.totals.answer)}); grades ${run.totals.grade.inputTokens} / ${run.totals.grade.outputTokens} (${money(run.totals.grade)}); rewrites ${run.totals.write.inputTokens} / ${run.totals.write.outputTokens} (${money(run.totals.write)}).`,
    `Total: ${money(run.totals.all)} (list-price upper bound ~$${run.totals.listPriceUsd.toFixed(4)}; estimate was ~$${run.estimateUsd.toFixed(4)}).`,
  ];
}

export function markdownSummary(run: RefreshRunReport): string {
  const out: string[] = [
    `# Starter answers refresh — ${run.apply ? "applied" : "dry run"}`,
    "",
    `- Target: ${run.target}`,
    `- Models: chat ${run.models.chat}, grader ${run.models.grade}, question writer ${run.models.write}`,
    `- ${run.startedAt} → ${run.finishedAt}`,
    ...runSummaryLines(run).map((line) => `- ${line}`),
    "",
  ];
  for (const set of run.chipSets) {
    out.push(`## ${set.name}${set.slug ? ` (\`${set.slug}\`)` : ""}`, "");
    out.push(`Write: ${set.write.replace(/_/g, " ")}${set.error ? ` (${set.error})` : ""} · rounds: ${set.rounds} · cached: ${set.cached}`, "");
    out.push("| Before | After |", "|---|---|");
    const rows = Math.max(set.before.length, set.after.length);
    for (let i = 0; i < rows; i += 1) out.push(`| ${cell(set.before[i])} | ${cell(set.after[i])} |`);
    out.push("", "| Question | Round | Verdict | Score | Cites | Why |", "|---|---|---|---|---|---|");
    for (const chip of set.chips) {
      out.push(
        `| ${cell(chip.question)} | ${chip.round} | ${chip.accepted ? "accepted" : "rejected"} | ${chip.score} | ${chip.citations} | ${cell([...chip.failures, ...chip.reasons].join("; "))} |`
      );
    }
    for (const sample of set.samples.slice(0, 1)) {
      out.push("", `<details><summary>Sample cached answer: ${escapeHtml(sample.question)}</summary>`, "", sample.text, "", "</details>");
    }
    out.push("");
  }
  return out.join("\n");
}

function cell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
