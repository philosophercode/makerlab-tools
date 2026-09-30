import { and, eq, lt } from "drizzle-orm";
import { createCategoryProposal, listAdminCategories, type AdminCategory } from "../data/category-admin.ts";
import { categoryProposals } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";

/**
 * The consolidation audit (`npm run taxonomy:audit`; taxonomy v2 spec §5.4):
 * looks over the live tree and **only proposes** — a `review_category`
 * proposal per finding, decided on `/admin/taxonomy` (merge, or dismiss). It
 * never renames, moves, merges or retires anything itself.
 *
 * Findings, each deterministic:
 *
 * - `sparse` — a leaf category (no live children) with 0 or 1 live tools:
 *   a candidate to merge into its sibling or parent.
 * - `crowded` — a category with more than {@link CROWDED_OVER} live tools:
 *   the Woodworking catch-all problem the review found.
 * - `duplicate_name` — the same name (any case) on two live categories under
 *   different parents: "Accessory", "3D Scanner" and "Workstation" were.
 * - `stale` — a proposal pending longer than {@link STALE_DAYS} days. Reported
 *   in the printout, not proposed again: a proposal about a proposal is noise.
 *
 * Idempotent: `createCategoryProposal` answers the pending proposal already
 * standing for the same flag and category, so a second run writes nothing.
 */

export const SPARSE_AT_MOST = 1;
export const CROWDED_OVER = 25;
export const STALE_DAYS = 14;

export type AuditFlag = "sparse" | "crowded" | "duplicate_name";

export interface AuditFinding {
  flag: AuditFlag;
  categoryId: string;
  categoryName: string;
  /** Why, in a sentence — stored as the proposal's reason. */
  reason: string;
  /** For `sparse`: the category it would most naturally merge into (its parent, else null). */
  suggestedTargetId: string | null;
}

export interface StaleProposal {
  id: string;
  name: string;
  days: number;
}

/** The findings for a set of categories — pure, so the rules test without a database. */
export function auditCategories(categories: readonly AdminCategory[]): AuditFinding[] {
  const live = categories.filter((category) => !category.retiredAt);
  const byId = new Map(live.map((category) => [category.id, category]));
  const hasChildren = new Set(live.filter((category) => category.parentId).map((category) => category.parentId as string));
  const findings: AuditFinding[] = [];

  for (const category of live) {
    if (!hasChildren.has(category.id) && category.toolCount <= SPARSE_AT_MOST) {
      const parent = category.parentId ? byId.get(category.parentId) : undefined;
      findings.push({
        flag: "sparse",
        categoryId: category.id,
        categoryName: category.name,
        reason:
          category.toolCount === 0
            ? `No tools are in "${category.name}". Merge it${parent ? ` into ${parent.name} or a sibling` : ""}, or retire it.`
            : `Only one tool is in "${category.name}". Consider merging it${parent ? ` into ${parent.name} or a sibling` : " into a neighbour"}.`,
        suggestedTargetId: parent?.id ?? null,
      });
    }
    if (category.toolCount > CROWDED_OVER) {
      findings.push({
        flag: "crowded",
        categoryId: category.id,
        categoryName: category.name,
        reason: `"${category.name}" holds ${category.toolCount} tools (over ${CROWDED_OVER}). Consider splitting it: propose second-level categories and move tools into them.`,
        suggestedTargetId: null,
      });
    }
  }

  const byName = new Map<string, AdminCategory[]>();
  for (const category of live) {
    const key = category.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), category]);
  }
  for (const group of byName.values()) {
    const parents = new Set(group.map((category) => category.parentId ?? `group:${category.group ?? ""}`));
    if (group.length < 2 || parents.size < 2) continue;
    for (const category of group) {
      const heading = (other: AdminCategory) => (other.parentId ? byId.get(other.parentId)?.name : other.group) ?? "top level";
      findings.push({
        flag: "duplicate_name",
        categoryId: category.id,
        categoryName: category.name,
        reason: `"${category.name}" appears under ${group.map(heading).join(" and ")}. One name, two meanings: rename one, or merge them.`,
        suggestedTargetId: null,
      });
    }
  }

  const order: Record<AuditFlag, number> = { crowded: 0, duplicate_name: 1, sparse: 2 };
  return findings.sort((a, b) => order[a.flag] - order[b.flag] || a.categoryName.localeCompare(b.categoryName, "en") || a.categoryId.localeCompare(b.categoryId));
}

/** Proposals pending longer than {@link STALE_DAYS} days, oldest first. */
export async function staleProposals(db: Db, now: Date = new Date()): Promise<StaleProposal[]> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);
  const rows = await db
    .select({ id: categoryProposals.id, name: categoryProposals.name, createdAt: categoryProposals.createdAt })
    .from(categoryProposals)
    .where(and(eq(categoryProposals.status, "pending"), lt(categoryProposals.createdAt, cutoff)));
  return rows
    .map((row) => ({ id: row.id, name: row.name, days: Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000) }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "en"));
}

export interface AuditRun {
  findings: AuditFinding[];
  stale: StaleProposal[];
  /** How many findings became a new proposal (the rest were already waiting). Zero on a dry run. */
  written: number;
}

/** Run the audit: read, find, and — unless `dryRun` — write one review proposal per new finding. */
export async function runTaxonomyAudit(db: Db, options: { dryRun?: boolean; now?: Date } = {}): Promise<AuditRun> {
  const findings = auditCategories(await listAdminCategories({ db }));
  const stale = await staleProposals(db, options.now);
  let written = 0;
  if (!options.dryRun) {
    for (const finding of findings) {
      const result = await createCategoryProposal(db, {
        kind: "review_category",
        name: finding.categoryName,
        source: "audit",
        subjectType: "category",
        subjectId: finding.categoryId,
        flag: finding.flag,
        reason: finding.reason,
        nearestExistingId: finding.suggestedTargetId,
      });
      if (result.ok && result.created) written++;
    }
  }
  return { findings, stale, written };
}

/** The run as the lines the script prints. */
export function formatAudit(run: AuditRun, dryRun: boolean): string[] {
  const lines = [`Findings: ${run.findings.length}.`];
  for (const finding of run.findings) lines.push(`  [${finding.flag}] ${finding.categoryName}: ${finding.reason}`);
  lines.push(`Proposals pending over ${STALE_DAYS} days: ${run.stale.length}.`);
  for (const proposal of run.stale) lines.push(`  ${proposal.name} — ${proposal.days} days`);
  lines.push(dryRun ? "Dry run: no proposals written." : `Proposals written: ${run.written} new (${run.findings.length - run.written} already waiting).`);
  return lines;
}
