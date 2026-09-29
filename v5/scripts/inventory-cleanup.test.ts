// @vitest-environment node
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { resources, tools, units } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { findToolForEditor } from "../src/lib/data/tools.ts";
import { parseArgs, summarize } from "./inventory-cleanup.ts";
import { runCleanup } from "./inventory-cleanup/apply.ts";
import { bundleSchema, loadBundle, type CleanupBundle } from "./inventory-cleanup/bundle.ts";

/**
 * The inventory cleanup (data/inventory-cleanup-2026-09-28) against an
 * in-process PGlite: dry run writes nothing, --apply writes through the data
 * layer, a second run writes nothing, and a value somebody changed since the
 * snapshot is left alone.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(resources);
  await db.delete(units);
  await db.delete(tools);
});

async function insertTool(slug: string, name: string, extra: Partial<typeof tools.$inferInsert> = {}): Promise<string> {
  const [row] = await db.insert(tools).values({ slug, name, published: true, ...extra }).returning({ id: tools.id });
  return row.id;
}

function bundle(overrides: Partial<CleanupBundle> = {}): CleanupBundle {
  return {
    renames: {
      tools: [
        { slug: "bosch-gst-150-bce", from: "BOSCH GST 150 BCE", to: "Bosch GST 150 BCE Jigsaw", officialName: "Bosch PRO GST 150 BCE Jigsaw", reason: "casing" },
      ],
      units: [{ toolSlug: "bosch-gst-150-bce", from: "BOSCH GST 150 BCE #1", to: "Bosch Jigsaw #1", reason: "casing" }],
    },
    tags: [{ slug: "bosch-gst-150-bce", remove: ["gst150bce deal price", "bosch gst 150 bce review"], add: ["jigsaw"], reason: "spam" }],
    starterQuestions: [
      { slug: "bosch-gst-150-bce", questions: ["How do I change the blade?", "Why does the blade wander off the line?", "Can I cut curves in plywood?"] },
    ],
    manuals: [
      {
        slug: "bosch-gst-150-bce",
        status: "found",
        url: "https://example.test/gst150bce.pdf",
        title: "Bosch GST 150 BCE Operating Instructions",
        source: "bosch (official)",
        confidence: "high",
        bytes: 1000,
        note: null,
      },
      { slug: "form-2", status: "found", url: "https://example.test/form2.pdf", title: "Form 2 Manual", source: "mirror", confidence: "low", bytes: 1, note: null },
      { slug: "stanley-coping-saw", status: "none_expected", url: null, title: null, source: null, confidence: null, note: "hand tool" },
    ],
    urls: [
      {
        toolSlug: "bosch-gst-150-bce",
        title: "SOP",
        from: "https://example.test/sop.pdf?utm_source=chatgpt.com",
        to: "https://example.test/sop.pdf",
      },
    ],
    manualsAdd: [],
    retitles: [],
    ...overrides,
  };
}

async function seedBosch(): Promise<string> {
  const id = await insertTool("bosch-gst-150-bce", "BOSCH GST 150 BCE", {
    tags: ["gst150bce deal price", "wood", "bosch gst 150 bce review"],
  });
  await db.insert(units).values({ toolId: id, unitLabel: "BOSCH GST 150 BCE #1" });
  await db.insert(resources).values({ toolId: id, title: "SOP", type: "SOP", url: "https://example.test/sop.pdf?utm_source=chatgpt.com" });
  return id;
}

describe("runCleanup", () => {
  it("writes nothing in a dry run, but says what it would do", async () => {
    const id = await seedBosch();
    const before = await findToolForEditor(id, { db });
    const report = await runCleanup(db, bundle(), { apply: false, includeLow: false });
    expect(report.changes.filter((c) => c.status === "applied").map((c) => c.section).sort()).toEqual(
      ["manual", "name", "officialName", "starterQuestions", "tags", "unit", "url"].sort()
    );
    const after = await findToolForEditor(id, { db });
    expect(after).toEqual(before);
  });

  it("applies every section through the data layer, then finds nothing left to do", async () => {
    const id = await seedBosch();
    await insertTool("form-2", "Form 2");
    const first = await runCleanup(db, bundle(), { apply: true, includeLow: false });
    expect(first.changes.some((c) => c.status === "refused")).toBe(false);

    const tool = await findToolForEditor(id, { db });
    expect(tool?.name).toBe("Bosch GST 150 BCE Jigsaw");
    expect(tool?.officialName).toBe("Bosch PRO GST 150 BCE Jigsaw");
    expect(tool?.tags).toEqual(["wood", "jigsaw"]);
    expect(tool?.starterQuestions).toHaveLength(3);
    const [unit] = await db.select().from(units).where(eq(units.toolId, id));
    expect(unit.unitLabel).toBe("Bosch Jigsaw #1");
    const links = await db.select().from(resources).where(eq(resources.toolId, id));
    expect(links.map((r) => [r.type, r.url]).sort()).toEqual(
      [
        ["Manual", "https://example.test/gst150bce.pdf"],
        ["SOP", "https://example.test/sop.pdf"],
      ].sort()
    );

    // The low-confidence manual waits for --include-low.
    const form2 = first.changes.find((c) => c.slug === "form-2");
    expect(form2?.status).toBe("skipped");
    expect(await db.select().from(resources).where(eq(resources.url, "https://example.test/form2.pdf"))).toHaveLength(0);

    const revision = (await findToolForEditor(id, { db }))!.revision;
    const second = await runCleanup(db, bundle(), { apply: true, includeLow: false });
    expect(second.changes.filter((c) => c.status === "applied")).toEqual([]);
    expect(second.changes.filter((c) => c.slug === "bosch-gst-150-bce").every((c) => c.status === "already")).toBe(true);
    expect((await findToolForEditor(id, { db }))!.revision).toEqual(revision);
  });

  it("adds a low-confidence manual with --include-low", async () => {
    await insertTool("form-2", "Form 2");
    await runCleanup(db, bundle(), { apply: true, includeLow: true });
    expect(await db.select().from(resources).where(eq(resources.url, "https://example.test/form2.pdf"))).toHaveLength(1);
  });

  it("retypes the same PDF filed under another type instead of linking it twice", async () => {
    const id = await insertTool("form-2", "Form 2");
    await db.insert(resources).values({ toolId: id, title: "Form 2 - SOP", type: "SOP", url: "https://example.test/form2.pdf" });
    const report = await runCleanup(db, bundle(), { apply: true, includeLow: true });
    expect(report.changes.find((c) => c.slug === "form-2" && c.section === "manual")?.detail).toMatch(/^retype/);
    const rows = await db.select().from(resources).where(eq(resources.toolId, id));
    expect(rows.map((r) => [r.type, r.title])).toEqual([["Manual", "Form 2 Manual"]]);
    const again = await runCleanup(db, bundle(), { apply: true, includeLow: true });
    expect(again.changes.find((c) => c.slug === "form-2" && c.section === "manual")?.status).toBe("already");
  });

  it("leaves alone what somebody changed since the snapshot", async () => {
    const id = await insertTool("bosch-gst-150-bce", "Bosch Jigsaw (blue)", {
      officialName: "Bosch GST 150 BCE",
      starterQuestions: ["What can I cut?"],
    });
    await db.insert(resources).values({ toolId: id, title: "Staff manual", type: "manual", url: "https://example.test/own.pdf" });
    const report = await runCleanup(db, bundle(), { apply: true, includeLow: false });
    const statusOf = (section: string) => report.changes.find((c) => c.section === section)?.status;
    expect(statusOf("name")).toBe("changed");
    expect(statusOf("officialName")).toBe("changed");
    expect(statusOf("starterQuestions")).toBe("changed");
    expect(statusOf("manual")).toBe("changed");
    const tool = await findToolForEditor(id, { db });
    expect(tool?.name).toBe("Bosch Jigsaw (blue)");
    expect(tool?.officialName).toBe("Bosch GST 150 BCE");
    expect(tool?.starterQuestions).toEqual(["What can I cut?"]);
  });

  it("refuses a rename onto another tool's name but still writes the rest", async () => {
    await insertTool("other", "Bosch GST 150 BCE Jigsaw");
    const id = await seedBosch();
    const report = await runCleanup(db, bundle(), { apply: true, includeLow: false });
    expect(report.changes.find((c) => c.section === "name")?.status).toBe("refused");
    const tool = await findToolForEditor(id, { db });
    expect(tool?.name).toBe("BOSCH GST 150 BCE");
    expect(tool?.tags).toEqual(["wood", "jigsaw"]);
  });

  it("reports a slug the database does not have", async () => {
    const report = await runCleanup(db, bundle(), { apply: true, includeLow: false });
    expect(report.changes.find((c) => c.slug === "bosch-gst-150-bce")?.status).toBe("not_found");
    expect(summarize(report).join("\n")).toContain("not_found");
  });
});

describe("the Bambu AMS bundle (2026-09-28-bambu-ams)", () => {
  const X1C = "bambu-lab-x1-carbon-combo-3d-printer";
  const DIR = fileURLToPath(new URL("../data/inventory-cleanup-2026-09-28-bambu-ams/", import.meta.url));
  const QSG = "https://cdn1.bambulab.com/documentation/quick-start-e254168f69145/X1C/English%20version-Quick%20Start%20Guide%20for%20X1-Carbon.pdf";
  const AMS = "https://cdn1.bambulab.com/documentation/quick-start-0fa3c8ddd3d3f/AMS/English%20version-Quick%20Start%20Guide%20for%20AMS.pdf";

  async function seedX1c(): Promise<string> {
    const id = await insertTool(X1C, "Bambu Lab X1-Carbon Combo 3D Printer");
    await db.insert(resources).values([
      { toolId: id, title: "Bambu Lab X1-Carbon Combo 3D Printer - SOP", type: "SOP", url: QSG },
      { toolId: id, title: "Bambu Lab X1-Carbon Combo quick start guide (PDF)", type: "Manual", url: "https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20X1-Carbon%20Combo.pdf" },
    ]);
    return id;
  }

  it("loads only the files it has, the rest empty", () => {
    const committed = loadBundle(DIR);
    expect(committed.manuals).toEqual([]);
    expect(committed.renames).toEqual({ tools: [], units: [] });
    expect(committed.manualsAdd.map((m) => [m.slug, m.url])).toEqual([[X1C, AMS]]);
    expect(committed.retitles.map((r) => [r.toolSlug, r.url, r.type])).toEqual([[X1C, QSG, "Manual"]]);
  });

  it("dry-runs, then retitles the mislabelled guide as a Manual and adds the AMS guide beside the tool's manuals, once", async () => {
    const id = await seedX1c();
    const committed = loadBundle(DIR);
    const dry = await runCleanup(db, committed, { apply: false, includeLow: false });
    expect(dry.changes.map((c) => [c.section, c.status])).toEqual([
      ["retitle", "applied"],
      ["manualAdd", "applied"],
    ]);
    expect(await db.select().from(resources).where(eq(resources.toolId, id))).toHaveLength(2);

    await runCleanup(db, committed, { apply: true, includeLow: false });
    const rows = await db.select().from(resources).where(eq(resources.toolId, id));
    expect(rows.map((r) => [r.type, r.title, r.url]).sort()).toEqual(
      [
        ["Manual", "Bambu Lab X1-Carbon Quick Start Guide", QSG],
        ["Manual", "Bambu Lab X1-Carbon Combo quick start guide (PDF)", "https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20X1-Carbon%20Combo.pdf"],
        ["Manual", "Bambu Lab AMS Quick Start Guide", AMS],
      ].sort()
    );

    const again = await runCleanup(db, committed, { apply: true, includeLow: false });
    expect(again.changes.map((c) => c.status)).toEqual(["already", "already"]);
  });

  it("leaves a resource staff renamed meanwhile alone", async () => {
    const id = await seedX1c();
    await db.update(resources).set({ title: "Staff SOP" }).where(eq(resources.url, QSG));
    const report = await runCleanup(db, loadBundle(DIR), { apply: true, includeLow: false });
    expect(report.changes.find((c) => c.section === "retitle")?.status).toBe("changed");
    const [row] = await db.select().from(resources).where(eq(resources.url, QSG));
    expect([row.title, row.type, row.toolId]).toEqual(["Staff SOP", "SOP", id]);
  });
});

describe("the committed bundle", () => {
  it("parses, names each tool once per file, and keeps every question a valid chip", () => {
    const committed = loadBundle();
    expect(() => bundleSchema.parse(committed)).not.toThrow();
    for (const list of [committed.renames.tools, committed.tags, committed.starterQuestions, committed.manuals]) {
      const slugs = list.map((entry) => entry.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
    for (const entry of committed.starterQuestions) {
      for (const question of entry.questions) {
        expect(question.length).toBeLessThanOrEqual(80);
        expect(question.endsWith("?")).toBe(true);
      }
    }
    for (const manual of committed.manuals.filter((m) => m.status === "found")) {
      expect(manual.url).toMatch(/^https:\/\//);
      expect(manual.url).not.toMatch(/[?&]utm_/);
      expect(manual.title).toBeTruthy();
    }
    for (const rename of committed.renames.tools) expect(rename.to.length).toBeLessThanOrEqual(40);
  });
});

describe("parseArgs", () => {
  it("is a dry run unless --apply", () => {
    expect(parseArgs([])).toEqual({ apply: false, includeLow: false, revalidate: null, bundle: null });
    expect(parseArgs(["--bundle", "data/x"]).bundle).toBe("data/x");
    expect(() => parseArgs(["--bundle"])).toThrow(/needs a directory/);
    expect(parseArgs(["--apply", "--include-low"])).toMatchObject({ apply: true, includeLow: true });
    expect(parseArgs(["--revalidate", "https://x.test/"]).revalidate).toBe("https://x.test");
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
  });
});
