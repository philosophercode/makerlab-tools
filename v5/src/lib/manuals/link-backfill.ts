import { and, eq, sql } from "drizzle-orm";
import { currentPdf } from "../data/manual-documents.ts";
import { manualSourceKey } from "../data/manual-archives.ts";
import { rawRows } from "../db/raw.ts";
import { attachments, resources } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { needsResolving } from "../research/resolve-manual-links.ts";
import { stripTrackingParams } from "../web/tracking-params.ts";
import { resolveManualPdf, type ResolvedManual } from "./resolve-pdf.ts";

/**
 * The two backfills of manual text spec amendment 2026-09-28, for rows
 * written before research learned them. Both **plan** first (read-only) and
 * **apply** only when asked; the scripts default to the plan.
 *
 * - {@link planManualPdfs} / {@link applyManualPdfs} — a Manual resource whose
 *   link is a download page, not the PDF, and that holds no stored PDF (the
 *   archive refused it as `not_pdf`): resolved with `resolve-pdf.ts`. Applying
 *   points the resource at the PDF and adds the page beside it as an "Other"
 *   link ("… — download page"); the nightly manual archive then copies the
 *   file (`cron/manual-archive.ts`), and `manuals:index` makes it searchable.
 * - {@link planTrackingCleanup} / {@link applyTrackingCleanup} — a resource
 *   link carrying `utm_*` and the like (`web/tracking-params.ts`). Applying
 *   rewrites the link **and re-keys its archived copy** (`manual:<resource>:<url>`),
 *   so the stored PDF stays the resource's current one (`currentPdf`).
 *
 * Plain Node: the scripts run it.
 */

// ── Download pages → PDFs ───────────────────────────────────────────

export interface ManualPdfPlan {
  resourceId: string;
  toolId: string | null;
  title: string;
  published: boolean;
  from: string;
  pdfUrl: string;
  landingUrl: string;
  via: string;
}

export interface ManualPdfPlanReport {
  changes: ManualPdfPlan[];
  unresolved: { resourceId: string; title: string; url: string; reason: string }[];
  checked: number;
}

interface CandidateRow {
  id: string;
  tool_id: string | null;
  title: string;
  url: string;
  type: string;
  published: boolean;
}

/** Manual resources with a web link and no stored PDF of it. */
export async function listManualLinksWithoutPdf(db: Db): Promise<CandidateRow[]> {
  return rawRows<CandidateRow>(
    db,
    sql`select r.id::text as id, r.tool_id::text as tool_id, r.title, r.url, r.type, r.published
          from resources r
         where lower(trim(coalesce(r.type, ''))) = 'manual'
           and r.url ~* '^https?://'
           and coalesce(r.origin, '') <> 'lab_document'
           and not exists (select 1 from attachments a where ${currentPdf("a", "r")})
         order by r.title, r.id`
  );
}

export async function planManualPdfs(
  db: Db,
  options: { resolve?: (url: string) => Promise<ResolvedManual>; log?: (line: string) => void } = {}
): Promise<ManualPdfPlanReport> {
  const resolve = options.resolve ?? ((url: string) => resolveManualPdf(url));
  const rows = (await listManualLinksWithoutPdf(db)).filter((row) => needsResolving({ title: row.title, url: row.url, type: "Manual" }));
  const report: ManualPdfPlanReport = { changes: [], unresolved: [], checked: rows.length };
  for (const row of rows) {
    let result: ResolvedManual;
    try {
      result = await resolve(row.url);
    } catch (error) {
      result = { status: "not_found", reason: error instanceof Error ? error.message : "failed", tried: [] };
    }
    if (result.status === "pdf" && result.pdfUrl !== row.url) {
      report.changes.push({
        resourceId: row.id,
        toolId: row.tool_id,
        title: row.title,
        published: row.published,
        from: row.url,
        pdfUrl: result.pdfUrl,
        landingUrl: result.landingUrl ?? row.url,
        via: result.via,
      });
      options.log?.(`  PDF   ${row.title}\n        ${row.url}\n      → ${result.pdfUrl}  (${result.via})`);
    } else {
      const reason = result.status === "not_found" ? result.reason : "already the PDF";
      report.unresolved.push({ resourceId: row.id, title: row.title, url: row.url, reason });
      options.log?.(`  —     ${row.title}  ${row.url}  (${reason})`);
    }
  }
  return report;
}

/** Point each resource at its PDF and keep the page beside it, one transaction. Returns the resources changed. */
export async function applyManualPdfs(db: Db, plans: readonly ManualPdfPlan[]): Promise<number> {
  if (plans.length === 0) return 0;
  return db.transaction(async (tx) => {
    let changed = 0;
    for (const plan of plans) {
      const updated = await tx
        .update(resources)
        .set({ url: plan.pdfUrl })
        .where(and(eq(resources.id, plan.resourceId), eq(resources.url, plan.from)))
        .returning({ id: resources.id });
      if (updated.length === 0) continue; // edited since the plan: left alone
      changed += 1;
      if (!plan.toolId) continue;
      const [already] = await tx
        .select({ id: resources.id })
        .from(resources)
        .where(and(eq(resources.toolId, plan.toolId), eq(resources.url, plan.landingUrl)));
      if (!already) {
        await tx.insert(resources).values({
          toolId: plan.toolId,
          title: `${plan.title} — download page`,
          type: "Other",
          url: plan.landingUrl,
          published: plan.published,
        });
      }
    }
    return changed;
  });
}

// ── Tracking parameters ─────────────────────────────────────────────

export interface TrackingPlan {
  resourceId: string;
  title: string;
  from: string;
  to: string;
  /** Archived copies keyed by the old link, re-keyed to the new one. */
  archives: string[];
}

export async function planTrackingCleanup(db: Db): Promise<TrackingPlan[]> {
  const rows = await db
    .select({ id: resources.id, title: resources.title, url: resources.url })
    .from(resources)
    .where(sql`${resources.url} ~* '^https?://' and ${resources.url} like '%?%'`);
  const plans: TrackingPlan[] = [];
  for (const row of rows) {
    if (!row.url) continue;
    const to = stripTrackingParams(row.url);
    if (to === row.url) continue;
    const archived = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.sourceKey, manualSourceKey(row.id, row.url)));
    plans.push({ resourceId: row.id, title: row.title, from: row.url, to, archives: archived.map((a) => a.id) });
  }
  return plans.sort((a, b) => a.title.localeCompare(b.title));
}

/** Rewrite each link and re-key its archived copies, one transaction. Returns the resources changed. */
export async function applyTrackingCleanup(db: Db, plans: readonly TrackingPlan[]): Promise<number> {
  if (plans.length === 0) return 0;
  return db.transaction(async (tx) => {
    let changed = 0;
    for (const plan of plans) {
      const updated = await tx
        .update(resources)
        .set({ url: plan.to })
        .where(and(eq(resources.id, plan.resourceId), eq(resources.url, plan.from)))
        .returning({ id: resources.id });
      if (updated.length === 0) continue;
      changed += 1;
      const newKey = manualSourceKey(plan.resourceId, plan.to);
      const [taken] = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.sourceKey, newKey));
      if (taken || plan.archives.length === 0) continue;
      // One copy takes the new key (the key is unique); any other stays stale, as an edit leaves it.
      await tx
        .update(attachments)
        .set({ sourceKey: newKey, sourceUrl: plan.to })
        .where(eq(attachments.id, plan.archives[0]));
    }
    return changed;
  });
}
