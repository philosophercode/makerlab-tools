// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { categories, categoryProposals, tools } from "../db/schema";
import type { AdminCategory } from "../data/category-admin";
import { parseAuditArgs } from "../../../scripts/taxonomy-audit";
import { auditCategories, CROWDED_OVER, formatAudit, runTaxonomyAudit } from "./audit";

/** The consolidation audit (taxonomy v2 spec §5.4): it finds, and it only proposes. */

function row(partial: Partial<AdminCategory> & { id: string; name: string }): AdminCategory {
  return {
    slug: partial.id,
    group: null,
    description: null,
    parentId: null,
    sortOrder: 0,
    galleryHidden: false,
    retiredAt: null,
    mergedIntoId: null,
    toolCount: 5,
    ...partial,
  };
}

describe("auditCategories", () => {
  it("flags a sparse leaf, a crowded category and one name under two parents — never a parent with children", () => {
    const findings = auditCategories([
      row({ id: "power", name: "Power Tools", toolCount: 0 }),
      row({ id: "routers", name: "Routers", parentId: "power", toolCount: 1 }),
      row({ id: "saws", name: "Saws", parentId: "power", toolCount: CROWDED_OVER + 1 }),
      row({ id: "cnc", name: "CNC", toolCount: 0 }),
      row({ id: "cnc-routers", name: "routers", parentId: "cnc", toolCount: 4 }),
      row({ id: "gone", name: "Gone", toolCount: 0, retiredAt: new Date() }),
    ]);
    expect(findings.map((finding) => [finding.flag, finding.categoryId])).toEqual([
      ["crowded", "saws"],
      ["duplicate_name", "cnc-routers"],
      ["duplicate_name", "routers"],
      ["sparse", "routers"],
    ]);
    expect(findings.find((finding) => finding.flag === "sparse")?.suggestedTargetId).toBe("power");
  });
});

describe("runTaxonomyAudit", () => {
  it("writes one review proposal per finding, none on a dry run, and none twice", async () => {
    const db = await createPgliteDb();
    const [top] = await db.insert(categories).values({ name: "Power Tools", slug: "power-tools" }).returning();
    const [lonely] = await db.insert(categories).values({ name: "Nailers", slug: "nailers", parentId: top.id }).returning();
    const [busy] = await db.insert(categories).values({ name: "Saws", slug: "saws", parentId: top.id }).returning();
    await db.insert(tools).values([
      { slug: "nailer", name: "Nailer", categoryId: lonely.id },
      ...Array.from({ length: 3 }, (_, n) => ({ slug: `saw-${n}`, name: `Saw ${n}`, categoryId: busy.id })),
    ]);
    await db.insert(categoryProposals).values({ name: "Old idea", source: "chat", createdAt: new Date("2026-01-01") });

    const dry = await runTaxonomyAudit(db, { dryRun: true, now: new Date("2026-09-28") });
    expect(dry.findings.map((finding) => finding.categoryName)).toEqual(["Nailers"]);
    expect(dry.stale).toEqual([expect.objectContaining({ name: "Old idea" })]);
    expect(dry.written).toBe(0);
    expect(formatAudit(dry, true).join("\n")).toContain("Dry run: no proposals written.");

    const first = await runTaxonomyAudit(db);
    expect(first.written).toBe(1);
    const second = await runTaxonomyAudit(db);
    expect(second.written).toBe(0);
    const proposals = await db.select().from(categoryProposals);
    expect(proposals.filter((proposal) => proposal.source === "audit")).toEqual([
      expect.objectContaining({ kind: "review_category", flag: "sparse", subjectType: "category", subjectId: lonely.id, nearestExistingId: top.id }),
    ]);
    // It only proposes: the tree is untouched.
    expect((await db.select().from(categories)).every((category) => category.retiredAt === null)).toBe(true);
  });

  it("takes --dry-run and nothing else", () => {
    expect(parseAuditArgs([])).toEqual({ dryRun: false });
    expect(parseAuditArgs(["--dry-run"])).toEqual({ dryRun: true });
    expect(() => parseAuditArgs(["--apply"])).toThrow(/Unknown argument/);
  });
});
