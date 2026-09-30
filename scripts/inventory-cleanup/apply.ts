/**
 * Apply the inventory cleanup bundle (./bundle.ts) through the app's data
 * layer — the same writes the tool editor makes:
 *
 * - **Tool fields** (display name, an empty official name, tags, starter
 *   questions) are one `updateTool` per tool, at the revision read just
 *   before, so a tool somebody edited meanwhile is `conflict`, and a name
 *   another tool holds is `duplicate_name` (the rest of that tool's fields
 *   are then written without the name).
 * - **Units, resources**: each is its own transaction that first touches the
 *   tool at its revision (`touchTool`), exactly as `src/lib/inventory/`'s
 *   `withTouchedTool` does for the editor — the tool's token moves, so an
 *   editor panel left open finds out.
 * - **Manuals** become resources of type `Manual` with the link, so the
 *   nightly manual archive copies the PDF and `npm run manuals:index` reads it.
 *
 * **Idempotent.** Every change is conditional on the value it replaces (a
 * rename only while the name is still the snapshot's, a manual only while the
 * tool has none, questions only while it has none), and a change already made
 * reports `already`. A second `--apply` writes nothing.
 *
 * No audit event, like the editor: §4.11 logs publishing and archiving, not
 * field edits. Cache invalidation (`invalidateCatalog`) needs `next/cache`,
 * which a script under plain Node does not have — the command says how to
 * refresh instead.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Revision } from "../../src/lib/data/revision.ts";
import { createResource, updateResource } from "../../src/lib/data/resources.ts";
import { findToolForEditor, touchTool, updateTool, type ToolPatch } from "../../src/lib/data/tools.ts";
import { updateUnit } from "../../src/lib/data/units.ts";
import { resources, units } from "../../src/lib/db/schema/index.ts";
import type { Db } from "../../src/lib/db/types.ts";
import { cleanStarterQuestions } from "../../src/lib/starter-questions.ts";
import type { CleanupBundle, ManualEntry } from "./bundle.ts";

export type Section = "name" | "officialName" | "tags" | "starterQuestions" | "unit" | "manual" | "url" | "retitle" | "manualAdd";

export type Status =
  | "applied" // written (or, in a dry run, would be)
  | "already" // the target value is already there
  | "changed" // the current value is neither the snapshot's nor the target — left alone
  | "not_found"
  | "skipped" // deliberately not applied (e.g. a low-confidence manual without --include-low)
  | "refused"; // the data layer said no (conflict, duplicate_name, invalid_field)

export interface Change {
  section: Section;
  slug: string;
  status: Status;
  detail: string;
}

export interface CleanupOptions {
  /** Write. False (the default) reads everything and writes nothing. */
  apply: boolean;
  /** Also add manuals whose link is marked low confidence. */
  includeLow: boolean;
  log?: (line: string) => void;
}

export interface CleanupReport {
  changes: Change[];
  counts: Record<Section, Partial<Record<Status, number>>>;
}

const MANUAL_TYPE = "Manual";

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/** Every slug the bundle touches, each once, in first-seen order. */
function slugsOf(bundle: CleanupBundle): string[] {
  const seen = new Set<string>();
  const all = [
    ...bundle.renames.tools.map((entry) => entry.slug),
    ...bundle.tags.map((entry) => entry.slug),
    ...bundle.starterQuestions.map((entry) => entry.slug),
    ...bundle.renames.units.map((entry) => entry.toolSlug),
    ...bundle.manuals.map((entry) => entry.slug),
    ...bundle.urls.map((entry) => entry.toolSlug),
    ...bundle.retitles.map((entry) => entry.toolSlug),
    ...bundle.manualsAdd.map((entry) => entry.slug),
  ];
  return all.filter((slug) => (seen.has(slug) ? false : (seen.add(slug), true)));
}

export async function runCleanup(db: Db, bundle: CleanupBundle, options: CleanupOptions): Promise<CleanupReport> {
  const changes: Change[] = [];
  const record = (change: Change) => {
    changes.push(change);
    options.log?.(`  ${change.status.padEnd(9)} ${change.section.padEnd(16)} ${change.slug}: ${change.detail}`);
  };

  for (const slug of slugsOf(bundle)) {
    const tool = await findToolForEditor(slug, { db });
    if (!tool) {
      record({ section: "name", slug, status: "not_found", detail: "no tool with this slug" });
      continue;
    }
    let revision: Revision = tool.revision;

    // ── Tool fields: one revision-checked write ──
    const patch: ToolPatch = {};
    const planned: Change[] = [];

    const rename = bundle.renames.tools.find((entry) => entry.slug === slug);
    if (rename) {
      if (tool.name === rename.to) planned.push({ section: "name", slug, status: "already", detail: rename.to });
      else if (tool.name === rename.from) {
        patch.name = rename.to;
        planned.push({ section: "name", slug, status: "applied", detail: `${rename.from} → ${rename.to}` });
      } else {
        planned.push({ section: "name", slug, status: "changed", detail: `now “${tool.name}”, expected “${rename.from}”` });
      }
      if (rename.officialName) {
        const current = tool.officialName?.trim() ?? "";
        if (current === rename.officialName) planned.push({ section: "officialName", slug, status: "already", detail: current });
        else if (current) planned.push({ section: "officialName", slug, status: "changed", detail: `kept “${current}”` });
        else {
          patch.officialName = rename.officialName;
          planned.push({ section: "officialName", slug, status: "applied", detail: `(empty) → ${rename.officialName}` });
        }
      }
    }

    const tagEdit = bundle.tags.find((entry) => entry.slug === slug);
    if (tagEdit) {
      const remove = new Set(tagEdit.remove);
      const kept = tool.tags.filter((tag) => !remove.has(tag));
      const next = [...kept, ...tagEdit.add.filter((tag) => !kept.includes(tag))];
      if (sameTags(next, tool.tags)) planned.push({ section: "tags", slug, status: "already", detail: `${tool.tags.length} tags` });
      else {
        patch.tags = next;
        const removed = tool.tags.filter((tag) => remove.has(tag));
        const added = next.filter((tag) => !tool.tags.includes(tag));
        planned.push({
          section: "tags",
          slug,
          status: "applied",
          detail: `−${removed.length} +${added.length} (${tool.tags.length} → ${next.length})`,
        });
      }
    }

    const starters = bundle.starterQuestions.find((entry) => entry.slug === slug);
    if (starters) {
      const questions = cleanStarterQuestions(starters.questions);
      if (tool.starterQuestions.length > 0) {
        const same = sameTags(tool.starterQuestions, questions);
        planned.push({ section: "starterQuestions", slug, status: same ? "already" : "changed", detail: same ? "" : "the tool has its own questions" });
      } else if (questions.length !== starters.questions.length) {
        planned.push({ section: "starterQuestions", slug, status: "refused", detail: "a question breaks the chip rules" });
      } else {
        patch.starterQuestions = questions;
        planned.push({ section: "starterQuestions", slug, status: "applied", detail: questions.join(" | ") });
      }
    }

    if (Object.keys(patch).length > 0 && options.apply) {
      let written = await updateTool(tool.id, patch, revision, { db, actorUserId: null });
      if (!written.ok && written.reason === "duplicate_name" && patch.name !== undefined) {
        for (const change of planned) {
          if (change.section === "name" && change.status === "applied") {
            change.status = "refused";
            change.detail += " (another tool has this name)";
          }
        }
        const rest: ToolPatch = { ...patch };
        delete rest.name;
        written = Object.keys(rest).length > 0 ? await updateTool(tool.id, rest, revision, { db, actorUserId: null }) : written;
      }
      if (written.ok) revision = written.revision;
      else {
        for (const change of planned) {
          if (change.status === "applied") {
            change.status = "refused";
            change.detail += ` (${written.reason})`;
          }
        }
      }
    }
    planned.forEach(record);

    // ── Units ──
    for (const relabel of bundle.renames.units.filter((entry) => entry.toolSlug === slug)) {
      const rows = await db
        .select({ id: units.id, label: units.unitLabel })
        .from(units)
        .where(eq(units.toolId, tool.id));
      const target = rows.find((row) => row.label === relabel.to);
      const source = rows.find((row) => row.label === relabel.from);
      if (target && !source) {
        record({ section: "unit", slug, status: "already", detail: relabel.to });
        continue;
      }
      if (!source) {
        record({ section: "unit", slug, status: "not_found", detail: `no unit labelled “${relabel.from}”` });
        continue;
      }
      const change: Change = { section: "unit", slug, status: "applied", detail: `${relabel.from} → ${relabel.to}` };
      if (options.apply) {
        const outcome = await touchedWrite(db, tool.id, revision, (tx) =>
          updateUnit(tx, { toolId: tool.id, unitId: source.id }, { unitLabel: relabel.to }, null)
        );
        if (outcome.ok) revision = outcome.revision;
        else {
          change.status = "refused";
          change.detail += ` (${outcome.reason})`;
        }
      }
      record(change);
    }

    // ── Tracking parameters off resource links ──
    for (const clean of bundle.urls.filter((entry) => entry.toolSlug === slug)) {
      const rows = await db
        .select({ id: resources.id, url: resources.url })
        .from(resources)
        .where(eq(resources.toolId, tool.id));
      const source = rows.find((row) => row.url === clean.from);
      if (!source) {
        const done = rows.some((row) => row.url === clean.to);
        record({ section: "url", slug, status: done ? "already" : "not_found", detail: clean.title });
        continue;
      }
      const change: Change = { section: "url", slug, status: "applied", detail: `${clean.title}: ${clean.to}` };
      if (options.apply) {
        const outcome = await touchedWrite(db, tool.id, revision, (tx) =>
          updateResource(tx, { toolId: tool.id, resourceId: source.id }, { url: clean.to }, { actorUserId: null })
        );
        if (outcome.ok) revision = outcome.revision;
        else {
          change.status = "refused";
          change.detail += ` (${outcome.reason})`;
        }
      }
      record(change);
    }

    // ── Resource titles (and types) ──
    for (const retitle of bundle.retitles.filter((entry) => entry.toolSlug === slug)) {
      const rows = await db
        .select({ id: resources.id, url: resources.url, title: resources.title, type: resources.type })
        .from(resources)
        .where(eq(resources.toolId, tool.id));
      const source = rows.find((row) => row.url === retitle.url);
      const typeDone = !retitle.type || source?.type?.toLowerCase() === retitle.type.toLowerCase();
      if (!source) {
        record({ section: "retitle", slug, status: "not_found", detail: `no resource at ${retitle.url}` });
        continue;
      }
      if (source.title === retitle.to && typeDone) {
        record({ section: "retitle", slug, status: "already", detail: retitle.to });
        continue;
      }
      if (source.title !== retitle.from && source.title !== retitle.to) {
        record({ section: "retitle", slug, status: "changed", detail: `now “${source.title}”, expected “${retitle.from}”` });
        continue;
      }
      const patch = { title: retitle.to, ...(retitle.type ? { type: retitle.type } : {}) };
      const change: Change = {
        section: "retitle",
        slug,
        status: "applied",
        detail: `“${source.title}” (${source.type ?? "no type"}) → “${retitle.to}”${retitle.type ? ` (${retitle.type})` : ""}`,
      };
      if (options.apply) {
        const outcome = await touchedWrite(db, tool.id, revision, (tx) =>
          updateResource(tx, { toolId: tool.id, resourceId: source.id }, patch, { actorUserId: null })
        );
        if (outcome.ok) revision = outcome.revision;
        else {
          change.status = "refused";
          change.detail += ` (${outcome.reason})`;
        }
      }
      record(change);
    }

    // ── Manuals added beside the tool's others ──
    for (const add of bundle.manualsAdd.filter((entry) => entry.slug === slug)) {
      const [sameUrl] = await db
        .select({ id: resources.id, type: resources.type, title: resources.title })
        .from(resources)
        .where(and(eq(resources.toolId, tool.id), eq(resources.url, add.url)));
      if (sameUrl && sameUrl.type?.toLowerCase() === "manual") {
        record({ section: "manualAdd", slug, status: "already", detail: `${sameUrl.title}: ${add.url}` });
        continue;
      }
      const change: Change = {
        section: "manualAdd",
        slug,
        status: "applied",
        detail: sameUrl ? `retype “${sameUrl.title}” as ${add.title}: ${add.url}` : `${add.title}: ${add.url}`,
      };
      if (options.apply) {
        const outcome = await touchedWrite(db, tool.id, revision, async (tx) => {
          if (sameUrl) {
            return updateResource(
              tx,
              { toolId: tool.id, resourceId: sameUrl.id },
              { type: MANUAL_TYPE, title: add.title },
              { actorUserId: null }
            );
          }
          const created = await createResource(
            tx,
            tool.id,
            { title: add.title, type: MANUAL_TYPE, url: add.url, published: true },
            { actorUserId: null }
          );
          return created.ok ? { ok: true as const } : created;
        });
        if (outcome.ok) revision = outcome.revision;
        else {
          change.status = "refused";
          change.detail += ` (${outcome.reason})`;
        }
      }
      record(change);
    }

    // ── Manuals ──
    const manual = bundle.manuals.find((entry) => entry.slug === slug);
    if (manual && manual.status === "found") {
      const { retypeResourceId, ...change } = await planManual(db, tool.id, slug, manual, options);
      if (change.status === "applied" && options.apply) {
        const outcome = await touchedWrite(db, tool.id, revision, async (tx) => {
          if (retypeResourceId) {
            return updateResource(
              tx,
              { toolId: tool.id, resourceId: retypeResourceId },
              { type: MANUAL_TYPE, title: manual.title! },
              { actorUserId: null }
            );
          }
          const created = await createResource(
            tx,
            tool.id,
            { title: manual.title!, type: MANUAL_TYPE, url: manual.url!, published: true },
            { actorUserId: null }
          );
          return created.ok ? { ok: true as const } : created;
        });
        if (outcome.ok) revision = outcome.revision;
        else {
          change.status = "refused";
          change.detail += ` (${outcome.reason})`;
        }
      }
      record(change);
    }
  }

  const counts = {} as CleanupReport["counts"];
  for (const change of changes) {
    const bySection = (counts[change.section] ??= {});
    bySection[change.status] = (bySection[change.status] ?? 0) + 1;
  }
  return { changes, counts };
}

type ManualChange = Change & { retypeResourceId?: string };

async function planManual(db: Db, toolId: string, slug: string, manual: ManualEntry, options: CleanupOptions): Promise<ManualChange> {
  const detail = `${manual.title} (${manual.confidence}) ${manual.url}`;
  if (!manual.url || !manual.title) return { section: "manual", slug, status: "skipped", detail: "no link or title" };
  const [existing] = await db
    .select({ id: resources.id, url: resources.url })
    .from(resources)
    .where(and(eq(resources.toolId, toolId), sql`lower(${resources.type}) = 'manual'`));
  const [sameUrl] = await db
    .select({ id: resources.id, type: resources.type, title: resources.title })
    .from(resources)
    .where(and(eq(resources.toolId, toolId), eq(resources.url, manual.url)));
  if (sameUrl && sameUrl.type?.toLowerCase() === "manual") return { section: "manual", slug, status: "already", detail };
  if (existing) return { section: "manual", slug, status: "changed", detail: `the tool has a manual now (${existing.url ?? "a file"})` };
  if (manual.confidence === "low" && !options.includeLow) {
    return { section: "manual", slug, status: "skipped", detail: `low confidence — pass --include-low to add: ${manual.url}` };
  }
  if (sameUrl) {
    // The manufacturer's manual was already linked under another type (an
    // import filed several as "SOP"): retype that link rather than list the
    // same PDF twice.
    return {
      section: "manual",
      slug,
      status: "applied",
      detail: `retype “${sameUrl.title}” (${sameUrl.type ?? "no type"}) as ${manual.title}: ${manual.url}`,
      retypeResourceId: sameUrl.id,
    };
  }
  return { section: "manual", slug, status: "applied", detail };
}

type Refusal = { ok: false; reason: string };

/**
 * One child write in a transaction that first touches the tool at `revision`,
 * the editor's `withTouchedTool` without the cache call. A refusal rolls back.
 */
async function touchedWrite(
  db: Db,
  toolId: string,
  revision: Revision,
  body: (tx: Db) => Promise<{ ok: true } | Refusal>
): Promise<{ ok: true; revision: Revision } | Refusal> {
  // No parameter property: scripts run under Node's strip-only TypeScript.
  class Rollback extends Error {
    readonly reason: string;
    constructor(reason: string) {
      super(reason);
      this.reason = reason;
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const touched = await touchTool(tx, toolId, revision, null);
      if (!touched.ok) throw new Rollback(touched.reason);
      const written = await body(tx);
      if (!written.ok) throw new Rollback(written.reason);
      return { ok: true as const, revision: touched.revision };
    });
  } catch (error) {
    if (error instanceof Rollback) return { ok: false, reason: error.reason };
    throw error;
  }
}
