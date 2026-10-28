// @vitest-environment node
import { eq } from "drizzle-orm";
import { completeResearch, createPendingBatch, markResearching, queueForResearch } from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { pendingTools, tools, units } from "../db/schema/index";
import type { ResearchResult } from "../research/result";
import { seedUser } from "../../../test/utils/session";
import { identityFor } from "../../../test/utils/identities";
import { cleanup, cleanupPromptFragment } from "./cleanup";

/**
 * The cleanup reads (assistant cleanup spec 2026-10-28 §3–§4): uncategorised
 * tools with research's category once the default tree exists, unit labels by
 * tool, and the approval queue with each item's photo verdict.
 */

const tool = (name: string) => cleanup.tools.find((t) => t.name === name)!;

beforeEach(() => vi.stubEnv("DATABASE_URL", ""));
afterEach(() => resetDbForTests());

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Bambu Lab H2D",
    description: "A dual-nozzle FDM printer.",
    specs: [],
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: null,
    useRestrictions: null,
    category: { name: "fdm-printers", group: null, existingId: null, slug: "fdm-printers" },
    resources: [],
    droppedLinks: [],
    sourceUrls: [],
    evidence: { userStatedModel: true, modelPlateRead: null, manufacturerPageFound: true, manualFound: true, specsFromSource: true, categoryOnly: false },
    confidence: { level: "high", basis: [], unknowns: [] },
    ...overrides,
  };
}

async function researched(createdBy: string, name: string, result: ResearchResult): Promise<string> {
  const batch = await createPendingBatch({ createdBy, items: [{ name }] });
  const id = batch.items[0].id;
  await queueForResearch([id], { requestedBy: createdBy });
  await markResearching(id);
  await completeResearch(id, result);
  return id;
}

describe("list_uncategorized_tools", () => {
  it("lists tools with no category and research's category once the lab has it — the default tree seeded on first use", async () => {
    const owner = await seedUser({ email: "isaac@cornell.edu", role: "admin", name: "Isaac" });
    const db = await getDb();
    const [h2d] = await db.insert(tools).values({ slug: "h2d", name: "H2D", published: true }).returning();
    await db.insert(tools).values({ slug: "mystery", name: "Mystery box" });
    await db.insert(tools).values({ slug: "gone", name: "Gone", archivedAt: new Date() });
    const pending = await researched(owner.id, "Bambu Lab H2D", research());
    await db.update(pendingTools).set({ createdToolId: h2d.id }).where(eq(pendingTools.id, pending));

    const result = (await tool("list_uncategorized_tools").run({}, {})) as { total: number; tools: { slug: string; suggested_category: string | null; state: string }[] };
    expect(result.total).toBe(2);
    expect(result.tools).toEqual([
      expect.objectContaining({ slug: "h2d", state: "published", suggested_category: "fdm-printers" }),
      expect.objectContaining({ slug: "mystery", state: "draft", suggested_category: null }),
    ]);
  });
});

describe("list_unit_labels", () => {
  it("groups units by tool, retired ones left out, optionally for some tools", async () => {
    const db = await getDb();
    const [a] = await db.insert(tools).values({ slug: "prusa-mk4", name: "Prusa MK4" }).returning();
    const [b] = await db.insert(tools).values({ slug: "zq-resin", name: "Zq Resin" }).returning();
    await db.insert(units).values([
      { toolId: a.id, unitLabel: "Prusa MK4 #1" },
      { toolId: a.id, unitLabel: "prusa 2" },
      { toolId: a.id, unitLabel: "Old one", status: "retired" },
      { toolId: b.id, unitLabel: "Zq Resin" },
    ]);
    const all = (await tool("list_unit_labels").run({ tool_ids: ["prusa-mk4", "zq-resin"] }, {})) as { tools: number; units: number; groups: { tool_slug: string; units: { label: string }[] }[] };
    expect(all.tools).toBe(2);
    expect(all.units).toBe(3);
    expect(all.groups.find((g) => g.tool_slug === "prusa-mk4")?.units.map((u) => u.label)).toEqual(["Prusa MK4 #1", "prusa 2"]);
    const some = (await tool("list_unit_labels").run({ tool_ids: ["zq-resin"] }, {})) as { groups: { tool_slug: string }[] };
    expect(some.groups.map((g) => g.tool_slug)).toEqual(["zq-resin"]);
  });
});

describe("review_approval_queue", () => {
  it("fences the names and gives each item whether a card can approve it, its category and its photo verdict", async () => {
    const owner = await seedUser({ email: "isaac@cornell.edu", role: "admin", name: "Isaac" });
    const before = (await tool("review_approval_queue").run({}, {})) as { total: number; ready_to_approve: number };
    const photo = { url: "https://maker.example/h2d.png", pageUrl: null, source: "og" as const, width: 1200, height: 900, contentType: "image/png" as const, rank: 1 as const, reason: "Front", background: "plain" as const, view: "front" as const };
    await researched(owner.id, "Bambu Lab H2D", research({ images: { candidates: [photo], cleaned: null } }));
    await researched(owner.id, "Hakko FX-888D", research({ canonicalName: "Hakko FX-888D", confidence: { level: "low", basis: [], unknowns: [] }, images: { candidates: [{ ...photo, composite: true }], cleaned: null } }));

    const result = (await tool("review_approval_queue").run({}, {})) as { total: number; ready_to_approve: number; items: string };
    expect(result.total - before.total).toBe(2);
    expect(result.ready_to_approve - before.ready_to_approve).toBe(1);
    expect(result.items).toContain("<untrusted-page");
    expect(result.items).toMatch(/Bambu Lab H2D[\s\S]*card can approve: yes · category on approval: 3D Printing › FDM Printers[\s\S]*photo: good/);
    expect(result.items).toMatch(/Hakko FX-888D[\s\S]*card can approve: no \(low confidence[\s\S]*photo: check — banner/);
    expect(tool("review_approval_queue").requiredPermission).toBe("tools.approve");
  });
});

describe("the playbook", () => {
  it("is in the prompt for staff who edit the catalogue, and nobody else", () => {
    expect(cleanupPromptFragment({ identity: identityFor("admin") } as never)).toContain("Cleaning up the catalogue");
    expect(cleanupPromptFragment({ identity: identityFor("user") } as never)).toBe("");
    expect(cleanupPromptFragment({ identity: identityFor("anonymous") } as never)).toBe("");
  });
});
