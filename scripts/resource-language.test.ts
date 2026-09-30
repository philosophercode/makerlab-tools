// @vitest-environment node
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { resources, tools } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { ENGLISH, GERMAN, repeat } from "../src/lib/research/language-samples.test-helpers.ts";
import type { ReadPageResult } from "../src/lib/web/read-page.ts";
import { findNonEnglish, formatReport, judgeOffline, loadResources, parseArgs, skipFetch } from "./resource-language.ts";

/**
 * The read-only language report (gateway spec amendment "English resources
 * only"). The database is an in-process PGlite; the reader is a stub, so
 * nothing reaches the network.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(resources);
  await db.delete(tools);
});

async function insertTool(slug: string, archived = false): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug, name: slug.replace(/-/g, " "), published: !archived, ...(archived ? { archivedAt: new Date() } : {}) })
    .returning({ id: tools.id });
  return row.id;
}

async function insertResource(toolId: string | null, title: string, url: string | null, type = "Other"): Promise<void> {
  await db.insert(resources).values({ toolId, title, url, type });
}

function page(url: string, text: string, lang?: string): ReadPageResult {
  return { url, status: "ok", contentType: "text/html", title: null, text, pdf: null, images: [], ...(lang ? { lang } : {}) };
}

describe("parseArgs", () => {
  it("reads --json, --no-fetch and --ids", () => {
    expect(parseArgs([])).toEqual({ json: false, fetch: true, ids: null });
    expect(parseArgs(["--json", "--no-fetch", "--ids", "a, b"])).toEqual({ json: true, fetch: false, ids: ["a", "b"] });
    expect(parseArgs(["--ids=x2d"]).ids).toEqual(["x2d"]);
    expect(() => parseArgs(["--dry-run"])).toThrow(/Unknown argument/);
  });
});

describe("judging without opening anything", () => {
  it("the address first, then the title", () => {
    expect(judgeOffline({ url: "https://maker.test/de-de/x2d", title: "X2D" })).toMatchObject({ verdict: "not_english", lang: "de", basis: "url" });
    expect(judgeOffline({ url: "https://maker.test/en-us/x2d", title: "X2D Bedienungsanleitung" }).verdict).toBe("english");
    expect(judgeOffline({ url: "https://maker.test/x2d.pdf", title: "X2D Bedienungsanleitung" })).toMatchObject({ basis: "title", lang: "de" });
    expect(judgeOffline({ url: "https://maker.test/x2d", title: "X2D manual" }).verdict).toBe("unknown");
  });

  it("never downloads a PDF or a video page", () => {
    expect(skipFetch("https://maker.test/manual.pdf")).toBe(true);
    expect(skipFetch("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(skipFetch("https://maker.test/x2d")).toBe(false);
    expect(skipFetch("ftp://maker.test/x2d")).toBe(true);
  });
});

describe("the report", () => {
  it("lists every tool resource that looks non-English, with slug, title, URL and reason, and writes nothing", async () => {
    const x2d = await insertTool("bambu-lab-x2d");
    const old = await insertTool("old-laser", true);
    await insertResource(x2d, "X2D product page", "https://bambulab.test/en-us/x2d");
    await insertResource(x2d, "X2D Produktseite", "https://bambulab.test/de-de/x2d");
    await insertResource(x2d, "X2D Bedienungsanleitung", "https://cdn.bambulab.test/x2d.pdf", "Manual");
    await insertResource(x2d, "X2D review", "https://reviews.test/x2d");
    await insertResource(x2d, "X2D overview", "https://blog.test/x2d");
    await insertResource(old, "Manuel", "https://laser.test/fr/manuel");
    await insertResource(x2d, "No link", null);
    await insertResource(null, "Orphan", "https://orphan.test/de/x");
    const before = await db.select().from(resources);

    const rows = await loadResources(db);
    expect(rows.map((row) => row.title)).toEqual([
      "X2D Bedienungsanleitung",
      "X2D overview",
      "X2D product page",
      "X2D Produktseite",
      "X2D review",
      "Manuel",
    ]);

    const opened: string[] = [];
    const read = vi.fn(async (url: string) => {
      opened.push(url);
      return url.includes("reviews") ? page(url, repeat(GERMAN, 3), "de") : page(url, repeat(ENGLISH, 3), "en");
    });
    const report = await findNonEnglish(rows, { fetch: true, read });

    // Only links with no signal of their own are opened, and never the PDF.
    expect(opened.sort()).toEqual(["https://blog.test/x2d", "https://reviews.test/x2d"]);
    expect(report).toMatchObject({ checked: 6, opened: 2 });
    expect(report.findings.map((f) => [f.slug, f.title, f.url, f.reason])).toEqual([
      ["bambu-lab-x2d", "X2D Bedienungsanleitung", "https://cdn.bambulab.test/x2d.pdf", "not English (de, from its title)"],
      ["bambu-lab-x2d", "X2D Produktseite", "https://bambulab.test/de-de/x2d", "not English (de, from its address)"],
      ["bambu-lab-x2d", "X2D review", "https://reviews.test/x2d", "not English (de, from the page's text)"],
      ["old-laser", "Manuel", "https://laser.test/fr/manuel", "not English (fr, from its address)"],
    ]);
    expect(report.findings[0].language).toBe("German");

    const text = formatReport(report);
    expect(text).toContain("4 look non-English:");
    expect(text).toContain('bambu-lab-x2d  "X2D Produktseite"  https://bambulab.test/de-de/x2d');

    // Read-only.
    expect(await db.select().from(resources)).toEqual(before);
  });

  it("opens nothing with --no-fetch, and narrows by --ids", async () => {
    const a = await insertTool("tool-a");
    const b = await insertTool("tool-b");
    await insertResource(a, "Page", "https://a.test/page");
    await insertResource(b, "Seite", "https://b.test/de/page");
    const read = vi.fn();
    const report = await findNonEnglish(await loadResources(db), { fetch: false, read });
    expect(read).not.toHaveBeenCalled();
    expect(report.findings.map((f) => f.slug)).toEqual(["tool-b"]);
    expect((await loadResources(db, { ids: ["tool-a"] })).map((row) => row.slug)).toEqual(["tool-a"]);
    expect(formatReport({ findings: [], checked: 1, opened: 0 })).toContain("No resource looks non-English.");
  });

  it("a page that cannot be read is no signal", async () => {
    const a = await insertTool("tool-a");
    await insertResource(a, "Page", "https://a.test/page");
    const read = vi.fn(async (url: string): Promise<ReadPageResult> => ({
      url,
      status: "failed",
      contentType: null,
      title: null,
      text: null,
      pdf: null,
      images: [],
      reason: "timeout",
    }));
    const report = await findNonEnglish(await loadResources(db), { fetch: true, read });
    expect(report.findings).toEqual([]);
  });
});
