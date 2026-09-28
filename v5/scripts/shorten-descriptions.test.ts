// @vitest-environment node
import { eq } from "drizzle-orm";
import { recordedCalls, textModel } from "../test/ai/models-stub.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { categories, tools } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { DESCRIPTION_RULES } from "../src/lib/description-rules.ts";
import { researchSystemPrompt } from "../src/lib/research/prompt.ts";
import {
  buildShortenPrompt,
  checkRewrite,
  estimateCost,
  loadDescriptionSources,
  parseShortenAnswer,
  runShortenDescriptions,
  SHORTEN_SYSTEM_PROMPT,
} from "./shorten-descriptions.ts";

/**
 * The description shortening script (gateway spec amendment 2026-09-26 "Short
 * descriptions"). The model is a `MockLanguageModelV3` handed straight to
 * `runShortenDescriptions`; the database an in-process PGlite. Nothing reaches
 * the Gateway.
 */

const SHORT =
  "The Formlabs Form 4 is a resin 3D printer. In a makerspace, students use it for detailed prototypes and small parts.";

/** An old-style description: a long paragraph and the spec sheet as a list. */
const LONG =
  "The Formlabs Form 4 is a masked stereolithography resin 3D printer. In a makerspace, students can use it to print " +
  "detailed prototypes, miniatures and small functional parts. It has a build volume of 200 × 125 × 210 mm and prints " +
  "at up to 100 mm/hr. Its light engine uses a 50 µm pixel size. It works with Formlabs resins.\n\n" +
  "- **Build volume:** 200 × 125 × 210 mm\n- **Pixel size:** 50 µm\n- **Print speed:** 100 mm/hr";

const REWRITE =
  "The Formlabs Form 4 is a masked stereolithography resin 3D printer with a 200 × 125 × 210 mm build volume. " +
  "In a makerspace, students use it to print detailed prototypes, miniatures and small functional parts.";

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(tools);
  await db.delete(categories);
});

async function insertTool(name: string, description: string | null): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60), name, description, published: true })
    .returning({ id: tools.id });
  return row.id;
}

async function descriptionOf(id: string): Promise<string | null> {
  const [row] = await db.select({ description: tools.description }).from(tools).where(eq(tools.id, id));
  return row.description;
}

describe("which tools it touches", () => {
  it("only descriptions that break the rule: over five sentences, too long, or a list", async () => {
    await insertTool("A Short One", SHORT);
    await insertTool("B Empty", null);
    await insertTool("C Listed", "A soldering station.\n\n- **Power:** 70 W");
    await insertTool("D Chatty", "One. Two. Three. Four. Five. Six.");
    await insertTool("E Long", `A heat gun ${"that is very useful ".repeat(30)}.`);
    const sources = await loadDescriptionSources(db, { ids: null, limit: null });
    expect(sources.map((s) => [s.name, s.problems])).toEqual([
      ["C Listed", ["has_list"]],
      ["D Chatty", ["too_many_sentences"]],
      ["E Long", ["too_long"]],
    ]);
    expect(sources[0].revision).toEqual(expect.any(String));
  });

  it("narrows by --ids (id or slug) and --limit", async () => {
    await insertTool("Form 4", LONG);
    const other = await insertTool("Other Printer", LONG);
    expect((await loadDescriptionSources(db, { ids: [other], limit: null })).map((s) => s.id)).toEqual([other]);
    expect((await loadDescriptionSources(db, { ids: ["form-4"], limit: null })).map((s) => s.name)).toEqual(["Form 4"]);
    expect(await loadDescriptionSources(db, { ids: null, limit: 1 })).toHaveLength(1);
  });
});

describe("the prompt and the answer", () => {
  it("shares the one rules text with research, and says only facts already in the description", () => {
    expect(SHORTEN_SYSTEM_PROMPT).toContain(DESCRIPTION_RULES);
    expect(researchSystemPrompt("read")).toContain(DESCRIPTION_RULES);
    expect(SHORTEN_SYSTEM_PROMPT).toContain("**Use only facts already in the current description.**");
    expect(SHORTEN_SYSTEM_PROMPT).toContain("drop the spec list");
    expect(SHORTEN_SYSTEM_PROMPT).toContain('{"description": "…"}');
  });

  it("shows the name, category and the whole description, fenced as data", () => {
    const prompt = buildShortenPrompt({ name: "Form 4", category: "Resin Printers", description: LONG });
    expect(prompt).toContain("<untrusted-page");
    expect(prompt).toContain("Name: Form 4");
    expect(prompt).toContain("Category: Resin Printers");
    expect(prompt).toContain("- **Print speed:** 100 mm/hr");
    expect(prompt.indexOf("<untrusted-page")).toBeLessThan(prompt.indexOf("Current description:"));
  });

  it("reads the description out of the answer", () => {
    expect(parseShortenAnswer(`{"description": "${SHORT}"}`)).toBe(SHORT);
    expect(parseShortenAnswer('{"description": "  "}')).toBeNull();
    expect(parseShortenAnswer("no json")).toBeNull();
  });

  it("refuses a rewrite that is empty, still breaks the rule, is not shorter, or adds a number", () => {
    expect(checkRewrite(LONG, REWRITE)).toBeNull();
    expect(checkRewrite(LONG, null)).toEqual({ reason: "no_answer" });
    expect(checkRewrite(LONG, "A printer.\n- **Speed:** 100 mm/hr")).toEqual({ reason: "still_breaks_rule", detail: "has_list" });
    expect(checkRewrite("A printer. It prints.", "A printer that prints resin.")).toEqual({ reason: "not_shorter" });
    expect(checkRewrite(LONG, "The Form 4 is a 25 L resin printer.")).toEqual({ reason: "new_numbers", detail: "25" });
  });

  it("estimates the cost before any call", async () => {
    await insertTool("Form 4", LONG);
    const estimate = estimateCost(await loadDescriptionSources(db, { ids: null, limit: null }));
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.usd).toBeGreaterThan(0);
  });
});

describe("runShortenDescriptions", () => {
  it("dry run: calls the model on the flex tier, prints before and after, and writes nothing", async () => {
    const id = await insertTool("Form 4", LONG);
    const model = textModel(JSON.stringify({ description: REWRITE }));
    const lines: string[] = [];
    const report = await runShortenDescriptions({
      db,
      model,
      sources: await loadDescriptionSources(db, { ids: null, limit: null }),
      dryRun: true,
      log: (line) => lines.push(line),
    });
    expect(report.tools[0].outcome).toEqual({ status: "would_write", description: REWRITE });
    expect(lines.join("\n")).toContain("before: The Formlabs Form 4 is a masked stereolithography");
    expect(lines.join("\n")).toContain(`after:  ${REWRITE}`);
    expect(await descriptionOf(id)).toBe(LONG);
    expect(recordedCalls(model)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
  });

  it("writes the checked rewrite, and a second run finds nothing to do", async () => {
    const id = await insertTool("Form 4", LONG);
    const report = await runShortenDescriptions({
      db,
      model: textModel(JSON.stringify({ description: REWRITE })),
      sources: await loadDescriptionSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect(report.tools[0].outcome).toEqual({ status: "written", description: REWRITE });
    expect(await descriptionOf(id)).toBe(REWRITE);
    expect(await loadDescriptionSources(db, { ids: null, limit: null })).toEqual([]);
  });

  it("leaves the description as it is when the rewrite invents a number", async () => {
    const id = await insertTool("Form 4", LONG);
    const report = await runShortenDescriptions({
      db,
      model: textModel(JSON.stringify({ description: "The Form 4 is a resin printer with a 12-inch screen." })),
      sources: await loadDescriptionSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect(report.tools[0].outcome).toMatchObject({ status: "rejected", reason: "new_numbers", detail: "12" });
    expect(await descriptionOf(id)).toBe(LONG);
  });

  it("skips a tool somebody edited after it was selected", async () => {
    const id = await insertTool("Form 4", LONG);
    const sources = await loadDescriptionSources(db, { ids: null, limit: null });
    // The revision is updated_at to the millisecond: let the clock move first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.update(tools).set({ description: "Edited by staff." }).where(eq(tools.id, id));
    const report = await runShortenDescriptions({
      db,
      model: textModel(JSON.stringify({ description: REWRITE })),
      sources,
      dryRun: false,
    });
    expect(report.tools[0].outcome).toEqual({ status: "skipped", reason: "conflict" });
    expect(await descriptionOf(id)).toBe("Edited by staff.");
  });
});
