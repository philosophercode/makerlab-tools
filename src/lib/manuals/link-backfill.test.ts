// @vitest-environment node
import { eq, inArray } from "drizzle-orm";
import { manualSourceKey } from "../data/manual-archives";
import { getDb, resetDbForTests } from "../db/client";
import { attachments, resources } from "../db/schema/index";
import { seedTool } from "../../../test/manuals/seed";
import { applyManualPdfs, applyTrackingCleanup, planManualPdfs, planTrackingCleanup } from "./link-backfill";
import type { ResolvedManual } from "./resolve-pdf";

/**
 * The two backfills of manual text spec amendment 2026-09-28, on the in-process
 * PGlite database: plan (read-only), then apply. The resolver is a stub here.
 */

const created: string[] = [];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(async () => {
  const db = await getDb();
  if (created.length) {
    await db.delete(attachments).where(inArray(attachments.ownerId, created));
    await db.delete(resources).where(inArray(resources.id, created));
  }
  created.length = 0;
});

afterAll(() => resetDbForTests());

async function resource(values: { toolId: string; title: string; url: string; type?: string; origin?: "lab_document" }) {
  const db = await getDb();
  const [row] = await db
    .insert(resources)
    .values({ type: "Manual", ...values })
    .returning({ id: resources.id });
  created.push(row.id);
  return row.id;
}

describe("download pages → PDFs", () => {
  it("plans only Manual links with no stored PDF, resolves them, and applies with the page kept beside", async () => {
    const db = await getDb();
    const toolId = await seedTool(db, { name: "Backfill Printer" });
    const page = await resource({ toolId, title: "Printer user manual", url: "https://maker.example/support/manual" });
    await resource({ toolId, title: "Already a PDF", url: "https://maker.example/m.pdf" });
    await resource({ toolId, title: "Lab SOP", url: "https://docs.google.com/document/d/1/edit", origin: "lab_document" });
    await resource({ toolId, title: "Product page", url: "https://maker.example/p", type: "Other" });
    const noPdf = await resource({ toolId, title: "Other manual", url: "https://maker.example/support/none" });

    const resolve = vi.fn(async (url: string): Promise<ResolvedManual> =>
      url.endsWith("/manual")
        ? { status: "pdf", pdfUrl: "https://maker.example/media/manual-en.pdf", landingUrl: url, via: "<iframe> src", hops: 1 }
        : { status: "not_found", reason: "no PDF on the page", tried: [url] }
    );
    const plan = await planManualPdfs(db, { resolve });
    expect(resolve.mock.calls.map(([url]) => url).sort()).toEqual([
      "https://maker.example/support/manual",
      "https://maker.example/support/none",
    ]);
    expect(plan.changes).toEqual([
      expect.objectContaining({ resourceId: page, pdfUrl: "https://maker.example/media/manual-en.pdf", landingUrl: "https://maker.example/support/manual" }),
    ]);
    expect(plan.unresolved).toEqual([expect.objectContaining({ resourceId: noPdf, reason: "no PDF on the page" })]);

    // Planning wrote nothing.
    const [before] = await db.select({ url: resources.url }).from(resources).where(eq(resources.id, page));
    expect(before.url).toBe("https://maker.example/support/manual");

    expect(await applyManualPdfs(db, plan.changes)).toBe(1);
    const rows = await db.select({ title: resources.title, url: resources.url, type: resources.type }).from(resources).where(eq(resources.toolId, toolId));
    created.push(...(await db.select({ id: resources.id }).from(resources).where(eq(resources.toolId, toolId))).map((r) => r.id));
    expect(rows).toEqual(
      expect.arrayContaining([
        { title: "Printer user manual", url: "https://maker.example/media/manual-en.pdf", type: "Manual" },
        { title: "Printer user manual — download page", url: "https://maker.example/support/manual", type: "Other" },
      ])
    );
    // Applying again changes nothing: the link moved since the plan.
    expect(await applyManualPdfs(db, plan.changes)).toBe(0);
  });
});

describe("tracking parameters", () => {
  it("plans the tracked links, applies, and re-keys the archived copy so it stays current", async () => {
    const db = await getDb();
    const toolId = await seedTool(db, { name: "Tracked Printer" });
    const tracked = "https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20X1-Carbon.pdf?utm_source=chatgpt.com";
    const clean = "https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20X1-Carbon.pdf";
    const id = await resource({ toolId, title: "X1-Carbon SOP", url: tracked, type: "SOP" });
    await resource({ toolId, title: "Plain", url: "https://maker.example/x?id=3" });
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: id,
      blobPathname: `manuals/${toolId}/${id}.pdf`,
      access: "public",
      publicUrl: "https://blob.test/x.pdf",
      contentType: "application/pdf",
      origin: "manual_archive",
      sourceKey: manualSourceKey(id, tracked),
      sourceUrl: tracked,
    });

    const plans = await planTrackingCleanup(db);
    expect(plans).toEqual([expect.objectContaining({ resourceId: id, from: tracked, to: clean, archives: [expect.any(String)] })]);
    expect(await applyTrackingCleanup(db, plans)).toBe(1);

    const [row] = await db.select({ url: resources.url }).from(resources).where(eq(resources.id, id));
    expect(row.url).toBe(clean);
    const [copy] = await db.select({ key: attachments.sourceKey, url: attachments.sourceUrl }).from(attachments).where(eq(attachments.ownerId, id));
    expect(copy).toEqual({ key: manualSourceKey(id, clean), url: clean });
    expect(await planTrackingCleanup(db)).toEqual([]);
  });
});
