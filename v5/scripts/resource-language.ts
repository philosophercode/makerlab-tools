/**
 * List tool resources that look non-English (gateway spec amendment
 * 2026-09-26 "English resources only").
 *
 *   npm run resources:language -- [--json] [--ids a,b,c] [--no-fetch]
 *
 * The owner's rule: "when finding a document or resource, the requirement is
 * to be in English. It needs to be an English website or manual." Research now
 * keeps English links only; this lists what is **already stored** that breaks
 * the rule, so staff can replace it. **Read-only**: it writes nothing and calls
 * no model.
 *
 * For every resource with a link on a tool (archived tools included):
 *
 * 1. **The URL's own locale** (`urlLanguage`): `/de-de/`, `?lang=fr`,
 *    `de.example.com`, `manual_DE.pdf`. English there settles it.
 * 2. **The title** (`titleLanguage`): a non-Latin title, or a foreign word for
 *    "manual" ("Bedienungsanleitung", "mode d'emploi").
 * 3. **The page itself**, unless `--no-fetch`: a link with no signal above is
 *    opened through `readPage` — the SSRF-guarded fetch — with a 6-second
 *    budget, four at a time, and judged by its text and `<html lang>`
 *    (`pageLanguage`). PDFs and videos are not downloaded.
 *
 * Unknown is never reported: only evidence is.
 *
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first).
 * - **`--json`** prints one JSON array on stdout (progress goes to stderr).
 * - **`--ids`** narrows to tools by id or slug.
 */
import { and, asc, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { isUuid } from "../src/lib/data/uuid.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { resources, tools } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import {
  describeJudgement,
  languageName,
  pageLanguage,
  titleLanguage,
  urlLanguage,
  type LanguageJudgement,
} from "../src/lib/research/language.ts";
import { readPage } from "../src/lib/web/read-page.ts";

export interface ResourceLanguageOptions {
  json: boolean;
  fetch: boolean;
  ids: string[] | null;
}

export function parseArgs(argv: readonly string[]): ResourceLanguageOptions {
  const options: ResourceLanguageOptions = { json: false, fetch: true, ids: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (flag === "--json") options.json = true;
    else if (flag === "--no-fetch") options.fetch = false;
    else if (flag === "--ids") {
      const next = inline ?? argv[++i];
      if (next === undefined) throw new Error("--ids needs a value.");
      const ids = next
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length === 0) throw new Error("--ids needs at least one tool id or slug.");
      options.ids = ids;
    } else {
      throw new Error(`Unknown argument ${arg}. Use --json, --no-fetch, --ids a,b,c.`);
    }
  }
  return options;
}

// ── Reading ─────────────────────────────────────────────────────────

export interface ResourceRow {
  resourceId: string;
  slug: string;
  toolName: string;
  title: string;
  url: string;
  type: string | null;
}

/** Every resource with a link on a tool, archived tools included, narrowed to `ids` (ids or slugs). */
export async function loadResources(db: Db, options: Pick<ResourceLanguageOptions, "ids"> = { ids: null }): Promise<ResourceRow[]> {
  const conditions: (SQL | undefined)[] = [isNotNull(resources.url), isNotNull(resources.toolId)];
  if (options.ids) {
    const uuids = options.ids.filter(isUuid);
    conditions.push(
      uuids.length > 0 ? or(inArray(tools.slug, options.ids), inArray(tools.id, uuids)) : inArray(tools.slug, options.ids)
    );
  }
  const rows = await db
    .select({
      resourceId: resources.id,
      slug: tools.slug,
      toolName: tools.name,
      title: resources.title,
      url: resources.url,
      type: resources.type,
    })
    .from(resources)
    .innerJoin(tools, eq(resources.toolId, tools.id))
    .where(and(...conditions))
    .orderBy(asc(tools.slug), asc(resources.title), asc(resources.id));
  // Sorted again in code: the database's collation is not the same everywhere, the report's order should be.
  return rows
    .filter((row): row is typeof row & { url: string } => typeof row.url === "string" && row.url.trim().length > 0)
    .map((row) => ({ ...row, url: row.url.trim() }))
    .sort((a, b) => compare(a.slug, b.slug) || compare(a.title.toLowerCase(), b.title.toLowerCase()) || compare(a.resourceId, b.resourceId));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Judging ─────────────────────────────────────────────────────────

export interface LanguageFinding {
  slug: string;
  tool: string;
  title: string;
  url: string;
  type: string | null;
  lang: string | null;
  language: string;
  basis: LanguageJudgement["basis"];
  reason: string;
}

/** The page budget for one link. */
export const FETCH_TIMEOUT_MS = 6000;
/** Links opened at once. */
export const FETCH_CONCURRENCY = 4;

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com)$/i;

/** True when opening the link would download a file or a video page rather than read a page's head. */
export function skipFetch(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    return url.pathname.toLowerCase().endsWith(".pdf") || VIDEO_HOST.test(url.hostname);
  } catch {
    return true;
  }
}

/** What the address and the title say, without opening anything. */
export function judgeOffline(row: Pick<ResourceRow, "url" | "title">): LanguageJudgement {
  const byUrl = urlLanguage(row.url);
  if (byUrl.verdict !== "unknown") return byUrl;
  return titleLanguage(row.title);
}

export interface FindOptions {
  fetch: boolean;
  /** The reader; `readPage` unless a test passes its own. */
  read?: typeof readPage;
  log?: (line: string) => void;
}

export interface FindReport {
  findings: LanguageFinding[];
  checked: number;
  opened: number;
}

/** The resources that look non-English, in `rows` order. Writes nothing. */
export async function findNonEnglish(rows: readonly ResourceRow[], options: FindOptions): Promise<FindReport> {
  const read = options.read ?? readPage;
  const log = options.log ?? (() => {});
  const verdicts = new Array<LanguageJudgement>(rows.length);
  const toOpen: number[] = [];
  for (const [n, row] of rows.entries()) {
    verdicts[n] = judgeOffline(row);
    if (verdicts[n].verdict === "unknown" && options.fetch && !skipFetch(row.url)) toOpen.push(n);
  }

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < toOpen.length) {
      const n = toOpen[next];
      next += 1;
      const row = rows[n];
      try {
        const page = await read(row.url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          timeoutMs: FETCH_TIMEOUT_MS,
          // A PDF is refused on its size, never downloaded: only a page's text is read.
          maxPdfBytes: 1,
        });
        if (page.status === "ok" && page.text) {
          verdicts[n] = pageLanguage({ url: page.url, lang: page.lang, text: page.text });
        }
      } catch {
        // readPage does not throw for an expected failure; anything else is "no signal".
      }
      done += 1;
      if (done % 10 === 0 || done === toOpen.length) log(`opened ${done}/${toOpen.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, toOpen.length) }, worker));

  const findings: LanguageFinding[] = [];
  for (const [n, row] of rows.entries()) {
    const judgement = verdicts[n];
    if (judgement.verdict !== "not_english") continue;
    findings.push({
      slug: row.slug,
      tool: row.toolName,
      title: row.title,
      url: row.url,
      type: row.type,
      lang: judgement.lang,
      language: languageName(judgement.lang),
      basis: judgement.basis,
      reason: `not English (${describeJudgement(judgement)})`,
    });
  }
  return { findings, checked: rows.length, opened: toOpen.length };
}

/** The report as a person reads it. */
export function formatReport(report: FindReport): string {
  const lines = [`Checked ${report.checked} resource link(s); opened ${report.opened}.`];
  if (report.findings.length === 0) {
    lines.push("No resource looks non-English.");
    return lines.join("\n");
  }
  lines.push(`${report.findings.length} look non-English:`);
  for (const finding of report.findings) {
    lines.push(`  ${finding.slug}  "${finding.title}"  ${finding.url}`);
    lines.push(`    ${finding.language}: ${finding.reason}`);
  }
  return lines.join("\n");
}

// ── The command ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { describeImportTarget, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  const say = (line: string) => (options.json ? console.error(line) : console.log(line));

  const target = resolveImportTarget();
  say(`Target: ${describeImportTarget(target)} — read-only, nothing is written`);

  let opened;
  try {
    opened = await openImportTarget(target);
  } catch (error) {
    if (error instanceof PgliteLockedError) {
      console.error(`${error.message}\nStop the dev server (it holds the local database), then run this again.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  try {
    const rows = await loadResources(opened.db, options);
    const report = await findNonEnglish(rows, { fetch: options.fetch, log: say });
    if (options.json) console.log(JSON.stringify(report.findings, null, 2));
    else console.log(formatReport(report));
  } finally {
    await opened.close();
  }
}

// Only run when invoked directly, so tests can import the pieces.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
