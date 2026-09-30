// @vitest-environment node
import { eq } from "drizzle-orm";
import { recordedCalls, textModel } from "../test/ai/models-stub.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { categories, tools } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { DISPLAY_NAME_RULES } from "../src/lib/display-name-rules.ts";
import { SUGGEST_SYSTEM_PROMPT } from "../src/lib/import/suggest-names.ts";
import { NAMES_PARAGRAPH } from "../src/lib/research/prompt.ts";
import {
  buildDisplayNamePrompt,
  chooseDisplayName,
  DISPLAY_NAME_SYSTEM_PROMPT,
  loadNameSources,
  runNameBackfill,
} from "./backfill-display-names.ts";

/**
 * The display-name backfill (tool display names spec §5.8). The model is a
 * `MockLanguageModelV3` handed straight to `runNameBackfill`; the database an
 * in-process PGlite. Nothing reaches the Gateway.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(tools);
  await db.delete(categories);
});

async function insertTool(name: string, officialName: string | null = null): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60), name, officialName, published: true })
    .returning({ id: tools.id });
  return row.id;
}

async function namesOf(id: string) {
  const [row] = await db.select({ name: tools.name, officialName: tools.officialName, slug: tools.slug }).from(tools).where(eq(tools.id, id));
  return row;
}

describe("which tools it touches", () => {
  it("only names that break the display rules — style is kept", async () => {
    await insertTool("Form 4");
    await insertTool("MAKITA Plunge Base");
    await insertTool("Bambu Lab X2D 3D Printer");
    await insertTool("Festool 575267 Dust Extractor CT Midi Hepa");
    await insertTool("iPad 6th generation [MR7F2LL./A]");
    const sources = await loadNameSources(db, { ids: null, limit: null });
    expect(sources.map((s) => s.name)).toEqual(["Festool 575267 Dust Extractor CT Midi Hepa", "iPad 6th generation [MR7F2LL./A]"]);
    expect(sources[0].problems).toEqual(["part_number", "too_long"]);
  });

  it("narrows by --ids and --limit", async () => {
    await insertTool("Festool 575267 Dust Extractor CT Midi Hepa");
    const ipad = await insertTool("iPad 6th generation [MR7F2LL./A]");
    expect((await loadNameSources(db, { ids: [ipad], limit: null })).map((s) => s.id)).toEqual([ipad]);
    expect(await loadNameSources(db, { ids: null, limit: 1 })).toHaveLength(1);
  });
});

describe("the prompt and the answer", () => {
  it("shows the name, its category, description and same-brand names, fenced as data", () => {
    const prompt = buildDisplayNamePrompt({
      name: "Festool 575267 Dust Extractor CT Midi Hepa",
      officialName: null,
      category: "Dust Extraction",
      categoryGroup: "Safety & Infrastructure",
      description: "x".repeat(500),
      similarNames: ["Festool Bench"],
    });
    expect(prompt).toContain("<untrusted-page");
    expect(prompt).toContain("Name: Festool 575267 Dust Extractor CT Midi Hepa");
    expect(prompt).toContain("Category: Safety & Infrastructure > Dust Extraction");
    expect(prompt).toContain(`Description: ${"x".repeat(400)}…`);
    expect(prompt).toContain('Other tools in the lab with the same brand: "Festool Bench"');
    expect(DISPLAY_NAME_SYSTEM_PROMPT).toContain("Makita Plunge Base");
    expect(DISPLAY_NAME_SYSTEM_PROMPT).toContain("never more than 40");
  });

  it("uses the one rules text research and Suggest names use", () => {
    expect(DISPLAY_NAME_SYSTEM_PROMPT).toContain(DISPLAY_NAME_RULES);
    expect(NAMES_PARAGRAPH).toContain(DISPLAY_NAME_RULES);
    expect(SUGGEST_SYSTEM_PROMPT).toContain(DISPLAY_NAME_RULES);
    expect(DISPLAY_NAME_RULES).toContain("Never the brand alone");
    expect(DISPLAY_NAME_RULES).toContain('"Dremel 3000"');
    expect(DISPLAY_NAME_RULES).toContain('"Ryobi ONE+ 1.5Ah Battery"');
  });

  it("lists the same-brand tools it must differ from", async () => {
    await insertTool("RYOBI ONE+ 18V Lithium-Ion 1.5 Ah Battery PBP002");
    await insertTool("RYOBI Drill Press");
    await insertTool("Form 4");
    const [battery] = await loadNameSources(db, { ids: null, limit: null });
    expect(battery.similarNames).toEqual(["RYOBI Drill Press"]);
  });

  it("guards the model's answer, and falls back to the guarded current name", () => {
    expect(chooseDisplayName('{"displayName":"Festool Dust Extractor"}', "Festool 575267 Dust Extractor CT Midi Hepa")).toBe(
      "Festool Dust Extractor"
    );
    expect(chooseDisplayName('{"displayName":"Festool 575267 Extractor"}', "x")).toBe("Festool Extractor");
    expect(chooseDisplayName("no json here", "Festool 575267 Dust Extractor CT Midi Hepa")).toBe("Festool Dust Extractor CT Midi Hepa");
    expect(chooseDisplayName("{}", "575267")).toBe("");
  });
});

describe("runNameBackfill", () => {
  it("dry run: calls the model, reports before → after, and writes nothing", async () => {
    const id = await insertTool("Festool 575267 Dust Extractor CT Midi Hepa");
    const model = textModel('{"displayName":"Festool Dust Extractor"}');
    const lines: string[] = [];
    const report = await runNameBackfill({
      db,
      model,
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: true,
      log: (line) => lines.push(line),
    });
    expect(report.tools[0].outcome).toEqual({
      status: "would_write",
      displayName: "Festool Dust Extractor",
      officialName: "Festool 575267 Dust Extractor CT Midi Hepa",
      officialKept: false,
    });
    expect(lines.join("\n")).toContain('"Festool 575267 Dust Extractor CT Midi Hepa" → "Festool Dust Extractor"');
    expect(await namesOf(id)).toMatchObject({ name: "Festool 575267 Dust Extractor CT Midi Hepa", officialName: null });
    // The backfill's own job and its flex tier.
    expect(recordedCalls(model)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
  });

  it("writes the short name and moves the long one to the official name; the slug stays", async () => {
    const id = await insertTool("STANLEY 20-221 10-Inch 12 Points Per Inch SharpTooth Mini Utility Saw");
    const before = await namesOf(id);
    await runNameBackfill({
      db,
      model: textModel('{"displayName":"Stanley Mini Utility Saw"}'),
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect(await namesOf(id)).toEqual({
      name: "Stanley Mini Utility Saw",
      officialName: "STANLEY 20-221 10-Inch 12 Points Per Inch SharpTooth Mini Utility Saw",
      slug: before.slug,
    });
  });

  it("never overwrites an official name that is already there", async () => {
    const id = await insertTool("Festool 575267 Dust Extractor CT Midi Hepa", "Festool CT MIDI I HEPA Mobile Dust Extractor 575267");
    const report = await runNameBackfill({
      db,
      model: textModel('{"displayName":"Festool Dust Extractor"}'),
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect(report.tools[0].outcome).toMatchObject({ status: "written", officialKept: true });
    expect(await namesOf(id)).toMatchObject({
      name: "Festool Dust Extractor",
      officialName: "Festool CT MIDI I HEPA Mobile Dust Extractor 575267",
    });
  });

  it("keeps a part number off the card even when the model answers with one", async () => {
    const id = await insertTool("DEWALT DCB107 12V/20V MAX Lithium Ion Charger");
    await runNameBackfill({
      db,
      model: textModel('{"displayName":"DeWalt DCB107 Charger"}'),
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect((await namesOf(id)).name).toBe("DeWalt Charger");
  });

  it("gives three batteries that shorten to one name each its capacity (amendment 2026-09-25)", async () => {
    const ids = [
      await insertTool("RYOBI ONE+ 18V Lithium-Ion 1.5 Ah Battery PBP002"),
      await insertTool("RYOBI ONE+ 18V Lithium-Ion 3.0 Ah Battery P103"),
      await insertTool("RYOBI ONE+ 18V Lithium-Ion 4 Ah Battery PBP004"),
    ];
    const report = await runNameBackfill({
      db,
      model: textModel('{"displayName":"Ryobi ONE+ Battery"}'),
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect(report.tools.map(({ outcome }) => outcome.status)).toEqual(["written", "written", "written"]);
    expect((await Promise.all(ids.map(namesOf))).map((row) => row.name)).toEqual([
      "Ryobi ONE+ 1.5Ah Battery",
      "Ryobi ONE+ 3Ah Battery",
      "Ryobi ONE+ 4Ah Battery",
    ]);
    // Written once, and a second run leaves them: the capacity is what tells them apart.
    expect(await loadNameSources(db, { ids: null, limit: null })).toEqual([]);
  });

  it("never takes a name a tool outside the batch already has", async () => {
    await insertTool("Makita Plunge Base");
    const longer = await insertTool("Makita 196094-2 Compact Router Plunge Base");
    const same = await insertTool("MAKITA 196094-2 Plunge Base");
    const report = await runNameBackfill({
      db,
      model: textModel('{"displayName":"Makita Plunge Base"}'),
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    // Its own long name through the guard is nobody's, so it takes that…
    expect((await namesOf(longer)).name).toBe("Makita Compact Router Plunge Base");
    // …and when that too is taken, it keeps the name it has.
    expect(report.tools.find(({ source }) => source.id === same)?.outcome).toEqual({ status: "skipped", reason: "duplicate_name" });
    expect((await namesOf(same)).name).toBe("MAKITA 196094-2 Plunge Base");
  });

  it("never writes a bare brand: the brand plus the category's noun instead", async () => {
    const [category] = await db.insert(categories).values({ name: "Soldering", group: "Electronics" }).returning({ id: categories.id });
    const id = await insertTool("HAKKO FX-888D");
    await db.update(tools).set({ categoryId: category.id, description: "A digital soldering station." }).where(eq(tools.id, id));
    const sources = await loadNameSources(db, { ids: null, limit: null });
    expect(sources[0]).toMatchObject({ category: "Soldering", categoryGroup: "Electronics" });
    const model = textModel('{"displayName":"Hakko"}');
    await runNameBackfill({ db, model, sources, dryRun: false });
    expect(await namesOf(id)).toMatchObject({ name: "Hakko Soldering Station", officialName: "HAKKO FX-888D" });
    // The model was shown what the item is.
    const prompt = JSON.stringify(recordedCalls(model)[0].prompt);
    expect(prompt).toContain("Category: Electronics > Soldering");
    expect(prompt).toContain("Description: A digital soldering station.");
  });

  it("keeps the old name rather than a bare brand when nothing says what the item is", async () => {
    const id = await insertTool("Weller WESD51");
    const report = await runNameBackfill({
      db,
      model: textModel('{"displayName":"Weller"}'),
      sources: await loadNameSources(db, { ids: null, limit: null }),
      dryRun: false,
    });
    expect(report.tools[0].outcome).toEqual({ status: "no_name" });
    expect((await namesOf(id)).name).toBe("Weller WESD51");
  });

  it("leaves a model line people say alone: Dremel 3000 breaks no rule", async () => {
    await insertTool("Dremel 3000");
    expect(await loadNameSources(db, { ids: null, limit: null })).toEqual([]);
  });

  it("skips a tool somebody renamed after it was read", async () => {
    const id = await insertTool("Festool 575267 Dust Extractor CT Midi Hepa");
    const sources = await loadNameSources(db, { ids: null, limit: null });
    await db.update(tools).set({ name: "Festool Midi" }).where(eq(tools.id, id));
    const report = await runNameBackfill({ db, model: textModel('{"displayName":"Festool Dust Extractor"}'), sources, dryRun: false });
    expect(report.tools[0].outcome).toEqual({ status: "skipped", reason: "renamed_meanwhile" });
    expect((await namesOf(id)).name).toBe("Festool Midi");
  });
});
