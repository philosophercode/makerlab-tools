import type { ActionProposalRecord } from "../data/action-proposals";
import type { ActionPreview } from "./define";

/**
 * The **Manuals** view of the Assistant proposals inbox, as data
 * (assistant–GUI parity spec, amendment 2026-10-07 "manual triage").
 *
 * An assistant connected over MCP can propose dozens of resource changes at
 * once: new manuals, replaced links, a new kind or title, hiding one. The
 * inbox's cards show one call each; this view regroups the same open rows **by
 * tool**, so the owner sees the tool's documents now and every change proposed
 * for it, and decides the tool in one go.
 *
 * Each row is described from the stored proposal: its input (what will run)
 * and its preview (the "before" the assistant saw), plus the tool's documents
 * as they are now. Never from the assistant's words. Values are text; a link
 * is offered only when it is `http(s)`.
 *
 * Pure: the page reads the rows and the tools and passes them in.
 */

/** The actions this view decides. Removal is destructive and never over MCP, so it never reaches the inbox. */
export const TRIAGE_ACTIONS: ReadonlySet<string> = new Set(["resources.add", "resources.edit"]);

/** What a row does, as a label. A row can do several (a new link and a new kind). */
export type TriageChange = "add_manual" | "add_link" | "replace_link" | "retype" | "retitle" | "hide" | "show" | "edit_notes" | "rearchive";

/** A document's four fields the view compares. */
export interface TriageDocState {
  title: string | null;
  type: string | null;
  url: string | null;
  hidden: boolean;
}

export type TriageField = keyof TriageDocState;

export interface TriageProposal {
  id: string;
  actionId: string;
  changes: TriageChange[];
  /** The document an edit changes; null for an addition. */
  resourceId: string | null;
  /** The document before (null for an addition): the assistant's "before" for the fields it changes, today's value for the rest. */
  before: TriageDocState | null;
  /** The document after the change. */
  after: TriageDocState;
  /** The fields whose value differs between before and after. */
  changed: TriageField[];
  /** A field the proposal changes whose value moved since it was proposed: confirming will answer `conflict`. */
  stale: TriageField[];
  /** The document an edit changes is gone. Confirming answers `not_found`. */
  missing: boolean;
  /** What **Open PDF** opens: the new link, else the document's link or stored copy. `http(s)` only. */
  openUrl: string | null;
  /** Whether {@link openUrl} looks like a PDF (its path ends in `.pdf`, or it is the stored copy). */
  openIsPdf: boolean;
  /** The host of the link after the change, without `www.`. */
  host: string | null;
  /** Pages in the stored copy, when the link is unchanged and the archive processed it. Never fetched for this page. */
  pages: number | null;
  expiresAt: string;
  /** The stored summary sentence, for screen readers and the fallback label. */
  summary: ActionPreview["summary"];
}

export interface TriageDocument {
  id: string;
  title: string;
  type: string | null;
  url: string | null;
  host: string | null;
  hidden: boolean;
  pages: number | null;
}

export interface TriageTool {
  toolId: string;
  name: string;
  /** The tool page's link, when the tool still exists. */
  link: string | null;
  /** A small picture of the tool, or null. */
  photo: string | null;
  documents: TriageDocument[];
  /** Oldest first: the order a tool-wide confirm runs them in. */
  proposals: TriageProposal[];
}

export interface ManualTriageView {
  tools: TriageTool[];
  proposalCount: number;
}

/** One of the tool's documents, as the loader reads it (`listResourcesForEditor`). */
export interface TriageSourceDocument {
  id: string;
  title: string;
  type: string | null;
  url: string | null;
  published: boolean;
  fileUrls: string[];
  archivedUrl?: string | null;
  manual?: { pageCount: number | null };
}

/** What the page loads for each tool named by a triage row. */
export interface TriageSourceTool {
  name: string;
  slug: string;
  photo: string | null;
  documents: TriageSourceDocument[];
}

interface AddInput {
  toolId: string;
  resource: { title: string; type?: string | null; url?: string | null; notes?: string | null; published?: boolean };
}

interface EditInput {
  toolId: string;
  resourceId: string;
  patch: { title?: string; type?: string | null; url?: string | null; notes?: string | null; published?: boolean };
}

/** The tool a triage row is for, or null when it is not a triage row. */
export function triageToolId(row: Pick<ActionProposalRecord, "actionId" | "input">): string | null {
  if (!TRIAGE_ACTIONS.has(row.actionId)) return null;
  const toolId = (row.input as { toolId?: unknown } | null)?.toolId;
  return typeof toolId === "string" && toolId ? toolId : null;
}

/** The rows this view decides: open, unexpired, a triage action. */
export function triageRows(rows: readonly ActionProposalRecord[]): ActionProposalRecord[] {
  return rows.filter((row) => row.status === "open" && !row.expired && triageToolId(row) !== null);
}

/** The tools the open triage rows name, each once. */
export function triageToolIds(rows: readonly ActionProposalRecord[]): string[] {
  return [...new Set(triageRows(rows).map((row) => triageToolId(row)!))];
}

/** Build the view. A row whose tool is not in `tools` (deleted since) is shown under its id, with no documents. */
export function buildManualTriage(rows: readonly ActionProposalRecord[], tools: ReadonlyMap<string, TriageSourceTool>): ManualTriageView {
  const byTool = new Map<string, TriageTool>();
  const open = triageRows(rows).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const row of open) {
    const toolId = triageToolId(row)!;
    const source = tools.get(toolId);
    let entry = byTool.get(toolId);
    if (!entry) {
      entry = {
        toolId,
        name: source?.name ?? String((row.preview as { summary?: { values?: { tool?: unknown } } }).summary?.values?.tool ?? toolId),
        link: source ? `/tools/${source.slug}` : null,
        photo: source?.photo ?? null,
        documents: (source?.documents ?? []).map(documentOf),
        proposals: [],
      };
      byTool.set(toolId, entry);
    }
    entry.proposals.push(proposalOf(row, source?.documents ?? []));
  }
  const list = [...byTool.values()].sort((a, b) => a.name.localeCompare(b.name) || a.toolId.localeCompare(b.toolId));
  return { tools: list, proposalCount: open.length };
}

function documentOf(doc: TriageSourceDocument): TriageDocument {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    url: safeUrl(doc.url),
    host: hostOf(doc.url),
    hidden: !doc.published,
    pages: doc.manual?.pageCount ?? null,
  };
}

function proposalOf(row: ActionProposalRecord, documents: readonly TriageSourceDocument[]): TriageProposal {
  const preview = row.preview as unknown as ActionPreview;
  const base = { id: row.id, actionId: row.actionId, expiresAt: row.expiresAt.toISOString(), summary: preview.summary };
  if (row.actionId === "resources.add") {
    const input = row.input as AddInput;
    const after: TriageDocState = {
      title: input.resource.title,
      type: input.resource.type ?? null,
      url: input.resource.url ?? null,
      hidden: input.resource.published === false,
    };
    const openUrl = safeUrl(after.url);
    return {
      ...base,
      changes: [isManual(after) ? "add_manual" : "add_link"],
      resourceId: null,
      before: null,
      after,
      changed: (["title", "type", "url", "hidden"] as const).filter((field) => field !== "hidden" || after.hidden),
      stale: [],
      missing: false,
      openUrl,
      openIsPdf: looksLikePdf(openUrl),
      host: hostOf(after.url),
      pages: null,
    };
  }

  const input = row.input as EditInput;
  const doc = documents.find((candidate) => candidate.id === input.resourceId) ?? null;
  const now: TriageDocState | null = doc ? { title: doc.title, type: doc.type, url: doc.url, hidden: !doc.published } : null;
  // The assistant's "before" for each field it changes (the card's), today's value for the rest.
  const shown = new Map((preview.rows ?? []).map((r) => [r.field, r.before]));
  const before: TriageDocState = {
    title: shown.has("resourceTitle") ? (shown.get("resourceTitle") ?? null) : (now?.title ?? null),
    type: shown.has("resourceType") ? (shown.get("resourceType") ?? null) : (now?.type ?? null),
    url: shown.has("url") ? (shown.get("url") ?? null) : (now?.url ?? null),
    hidden: shown.has("catalogue") ? shown.get("catalogue") === "unpublished" : (now?.hidden ?? false),
  };
  const patch = input.patch ?? {};
  const after: TriageDocState = {
    title: patch.title !== undefined ? patch.title : before.title,
    type: patch.type !== undefined ? patch.type : before.type,
    url: patch.url !== undefined ? patch.url : before.url,
    hidden: patch.published !== undefined ? !patch.published : before.hidden,
  };
  const changed = (["title", "type", "url", "hidden"] as const).filter((field) => before[field] !== after[field]);
  const patched: TriageField[] = [
    ...(patch.title !== undefined ? (["title"] as const) : []),
    ...(patch.type !== undefined ? (["type"] as const) : []),
    ...(patch.url !== undefined ? (["url"] as const) : []),
    ...(patch.published !== undefined ? (["hidden"] as const) : []),
  ];
  const stale = now ? patched.filter((field) => now[field] !== before[field]) : [];

  const changes: TriageChange[] = [];
  if (changed.includes("url")) changes.push("replace_link");
  if (changed.includes("type")) changes.push("retype");
  if (changed.includes("title")) changes.push("retitle");
  if (changed.includes("hidden")) changes.push(after.hidden ? "hide" : "show");
  if (patch.notes !== undefined) changes.push("edit_notes");
  // An edit that changes no field but names a link or a kind asks the manual
  // archive to run again (resources.edit's afterCommit).
  if (changes.length === 0 && (patch.url || patch.type !== undefined)) changes.push("rearchive");

  const linkUnchanged = !changed.includes("url");
  const openUrl = safeUrl(after.url) ?? (linkUnchanged ? (safeUrl(doc?.archivedUrl) ?? safeUrl(doc?.fileUrls[0])) : null);
  return {
    ...base,
    changes,
    resourceId: input.resourceId,
    before,
    after,
    changed,
    stale,
    missing: doc === null,
    openUrl,
    openIsPdf: looksLikePdf(openUrl) || (openUrl !== null && openUrl === safeUrl(doc?.archivedUrl)),
    host: hostOf(after.url),
    pages: linkUnchanged ? (doc?.manual?.pageCount ?? null) : null,
  };
}

/** A new document is a manual when its kind says so, or its link is a PDF. */
function isManual(doc: TriageDocState): boolean {
  return /manual|guide|handbook|instructions/i.test(doc.type ?? "") || looksLikePdf(safeUrl(doc.url));
}

/** The URL when it is `http(s)`, else null: nothing else becomes a link on this page. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function looksLikePdf(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}
