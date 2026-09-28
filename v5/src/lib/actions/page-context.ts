import "server-only";

import { z } from "zod";
import type { Identity } from "../auth/identity";
import { can, canReachAdmin, type Permission } from "../auth/permissions";
import {
  correctionSubjects,
  findActiveToolByRef,
  pendingSubjects,
  projectSubjects,
  ticketSubjects,
  toolSubjects,
} from "../data/action-subjects";
import { getBulkImport } from "../data/bulk-imports";
import { isUuid } from "../data/uuid";
import { canActOnImport } from "../import/access";
import { canActOnPendingTool } from "../intake/access";
import { fenceUntrusted, inlineText, OTHERS_TEXT_NOTE } from "../web/fence";

/**
 * Where the person is (assistant–GUI parity spec §3.6): the page, the record
 * it shows, the rows they have ticked — so "resolve these" and "publish this"
 * need no guessing.
 *
 * **The browser names; the server reads.** The chat sends a path and, at
 * most, fifty ids of one kind. Here the path is matched against
 * {@link PAGE_CONTEXTS} (an unknown one is dropped and never echoed into the
 * prompt), the selection's kind must be the kind that page selects, every id
 * must be a uuid, and every row is loaded from the database **only if the
 * caller holds the permission the page itself checks**. What reaches the
 * prompt is the database's names and states, never text the client sent.
 *
 * **Only for somebody who can act.** A visitor or a student has no action
 * tool, so their prompt gains no block (the tool page's own section already
 * names the tool they are looking at); the block is for anybody who can
 * reach an admin surface.
 *
 * **Page context grants nothing.** It narrows and defaults; which tools a
 * person is offered is still `capabilitiesForIdentity`, and every proposal is
 * still checked by its definition. A forged selection can at most put a
 * record the person may already act on into the block — and the ones they
 * may not are dropped before any read.
 */

/** The kinds of row a page's selection can hold. */
export const SELECTION_KINDS = ["maintenance_log", "feedback", "project", "tool", "pending_tool"] as const;
export type SelectionKind = (typeof SELECTION_KINDS)[number];

/** The most selected rows one message carries (§3.6). */
export const MAX_SELECTION = 50;

/** What the chat body may carry, validated before anything is read. */
export const pageContextSchema = z.object({
  path: z.string().max(300),
  selection: z
    .object({
      kind: z.string().max(40),
      ids: z.array(z.string().max(64)).max(MAX_SELECTION),
    })
    .optional(),
});
export type PageContextInput = z.infer<typeof pageContextSchema>;

/** One loaded row: its id and the line the prompt shows for it. */
interface Line {
  id: string;
  text: string;
}

interface PageEntry {
  pattern: RegExp;
  /** The page's name in the prompt. English: the prompt is. */
  name: string;
  /** The permission the page itself checks; no record is read for anyone else. */
  permission?: Permission;
  /** The record the page shows, from the path's captured segment. */
  subject?: (segment: string, identity: Identity) => Promise<string | null>;
  selection?: { kind: SelectionKind; noun: string; load: (ids: string[], identity: Identity) => Promise<Line[]> };
}

/*
 * Every stored text below goes through `inlineText`: flattened to one line,
 * capped and quoted, so a ticket title with a line break cannot add a fake
 * row to the block.
 */
const ticketLines = async (ids: string[]): Promise<Line[]> =>
  (await ticketSubjects(ids)).map((t) => ({
    id: t.id,
    text: `ticket id=${t.id}: ${inlineText(t.title)} — ${t.toolName ? inlineText(t.toolName, 80) : "no tool"}${t.unitLabel ? ` / ${inlineText(t.unitLabel, 60)}` : ""} · ${t.status}${t.priority ? ` · ${t.priority}` : ""}`,
  }));

const correctionLines = async (ids: string[]): Promise<Line[]> =>
  (await correctionSubjects(ids)).map((c) => ({
    id: c.id,
    text: `correction id=${c.id}: ${c.toolName ? inlineText(c.toolName, 80) : "no tool"}${c.fieldFlagged ? ` · ${inlineText(c.fieldFlagged, 60)}` : ""} · ${c.status}`,
  }));

const projectLines = async (ids: string[]): Promise<Line[]> =>
  (await projectSubjects(ids)).map((p) => ({
    id: p.id,
    text: `project id=${p.id}: ${inlineText(p.title)} · ${p.published ? "published" : "not published"}`,
  }));

/** Only items the caller may act on: their own, or any for a reviewer (`canActOnPendingTool`). */
const pendingLines = async (ids: string[], identity: Identity): Promise<Line[]> =>
  (await pendingSubjects(ids)).filter((p) => canActOnPendingTool(identity, p)).map((p) => ({
    id: p.id,
    text: `pending item id=${p.id}: ${inlineText(p.name, 120)}${p.brand ? ` (${inlineText(p.brand, 60)})` : ""} · ${p.status}`,
  }));

const toolLines = async (ids: string[]): Promise<Line[]> =>
  (await toolSubjects(ids)).map((t) => ({
    id: t.id,
    text: `tool id=${t.id} (slug ${t.slug}): ${inlineText(t.name, 120)} · ${t.archived ? "archived" : t.published ? "published" : "draft"}`,
  }));

/**
 * Route patterns → what the page is (§3.6). First match wins; a path that
 * matches none is ignored whole.
 */
export const PAGE_CONTEXTS: readonly PageEntry[] = [
  { pattern: /^\/admin\/users$/, name: "People (/admin/users)", permission: "users.manage" },
  {
    pattern: /^\/admin\/maintenance$/,
    name: "the maintenance queue (/admin/maintenance)",
    permission: "maintenance.manage",
    selection: { kind: "maintenance_log", noun: "tickets", load: ticketLines },
  },
  {
    pattern: /^\/admin\/corrections$/,
    name: "the corrections queue (/admin/corrections)",
    permission: "feedback.manage",
    selection: { kind: "feedback", noun: "corrections", load: correctionLines },
  },
  {
    pattern: /^\/admin\/projects$/,
    name: "the project queue (/admin/projects)",
    permission: "projects.moderate",
    selection: { kind: "project", noun: "projects", load: projectLines },
  },
  {
    pattern: /^\/admin\/inventory$/,
    name: "the inventory review table (/admin/inventory)",
    permission: "tools.edit",
    selection: { kind: "tool", noun: "tools", load: toolLines },
  },
  {
    pattern: /^\/admin\/intake$/,
    name: "the intake queue (/admin/intake)",
    permission: "tools.approve",
    selection: { kind: "pending_tool", noun: "pending items", load: pendingLines },
  },
  {
    pattern: /^\/admin\/intake\/([0-9a-f-]{36})$/i,
    name: "a pending item's review page",
    permission: "tools.approve",
    subject: async (id) => {
      if (!isUuid(id)) return null;
      const [item] = await pendingSubjects([id]);
      return item ? `pending item id=${item.id}: ${inlineText(item.name, 120)}${item.brand ? ` (${inlineText(item.brand, 60)})` : ""} · ${item.status}` : null;
    },
  },
  {
    pattern: /^\/admin\/intake\/imports\/([0-9a-f-]{36})$/i,
    name: "one bulk import's review (/admin/intake/imports/…)",
    permission: "tools.add",
    subject: async (id, identity) => {
      if (!isUuid(id)) return null;
      const found = await getBulkImport(id);
      // Somebody else's import is named only to a reviewer, as the page itself does.
      if (!found || !canActOnImport(identity, found)) return null;
      return `import id=${found.id}: ${inlineText(found.sourceName ?? "pasted list", 120)} · ${found.status}`;
    },
    selection: { kind: "pending_tool", noun: "import rows", load: pendingLines },
  },
  { pattern: /^\/admin\/intake\/imports$/i, name: "bulk imports (/admin/intake/imports)", permission: "tools.add" },
  { pattern: /^\/admin\/refresh(\/[0-9a-f-]{36})?$/i, name: "refresh research (/admin/refresh)", permission: "tools.edit" },
  { pattern: /^\/admin\/mirror$/, name: "the Notion mirror settings (/admin/mirror)", permission: "mirror.manage" },
  { pattern: /^\/admin\/research$/, name: "the manual library (/admin/research)", permission: "tools.edit" },
  { pattern: /^\/admin$/, name: "the admin home (/admin)" },
  {
    pattern: /^\/tools\/([^/]+)$/,
    name: "a tool's page",
    subject: async (segment, identity) => {
      let ref: string;
      try {
        ref = decodeURIComponent(segment);
      } catch {
        return null;
      }
      const tool = await findActiveToolByRef(ref);
      // A draft is named only to somebody who may see drafts — anyone else's
      // page for it was a 404 (AGENTS.md "Drafts are reachable…").
      if (!tool || (!tool.published && !can(identity, "catalog.view_drafts"))) return null;
      return `tool id=${tool.id} (slug ${tool.slug}): ${inlineText(tool.name, 120)} · ${tool.published ? "published" : "draft"}`;
    },
  },
  { pattern: /^\/$/, name: "the tool gallery (/)" },
  { pattern: /^\/projects(\/[^/]+)?$/, name: "the projects gallery (/projects)" },
];

export interface PageContext {
  /** The page's name, or null for a path no entry knows. */
  page: string | null;
  subject: string | null;
  selection: { noun: string; lines: string[] } | null;
}

/**
 * Read what the person is looking at, as `identity` may see it. Never throws:
 * a read that fails leaves the block out and the chat carries on.
 */
export async function loadPageContext(identity: Identity, raw: unknown): Promise<PageContext> {
  const empty: PageContext = { page: null, subject: null, selection: null };
  if (!canReachAdmin(identity)) return empty;
  const parsed = pageContextSchema.safeParse(raw);
  if (!parsed.success) return empty;
  const { path, selection } = parsed.data;
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

  for (const entry of PAGE_CONTEXTS) {
    const match = clean.match(entry.pattern);
    if (!match) continue;
    // A page the person may not open tells the assistant nothing about it.
    if (entry.permission && !can(identity, entry.permission)) return empty;
    try {
      const subject = entry.subject && match[1] ? await entry.subject(match[1], identity) : null;
      let chosen: PageContext["selection"] = null;
      if (entry.selection && selection && selection.kind === entry.selection.kind) {
        const ids = [...new Set(selection.ids.filter(isUuid))].slice(0, MAX_SELECTION);
        if (ids.length > 0) {
          const lines = await entry.selection.load(ids, identity);
          // In the order the person ticked them; unknown ids simply vanish.
          const byId = new Map(lines.map((line) => [line.id, line.text]));
          const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as string] : []));
          if (ordered.length > 0) chosen = { noun: entry.selection.noun, lines: ordered };
        }
      }
      return { page: entry.name, subject, selection: chosen };
    } catch (error) {
      console.warn(`[chat] page context not loaded: ${error instanceof Error ? error.name : "error"}`);
      return { page: entry.name, subject: null, selection: null };
    }
  }
  return empty;
}

/**
 * The fenced "Where the person is" block (§3.6), or "" when there is nothing
 * to say. Record names and states are fenced: a ticket title is a visitor's
 * words.
 */
export function pageContextSection(context: PageContext): string {
  if (!context.page) return "";
  const lines: string[] = [];
  if (context.subject) lines.push(`Showing: ${context.subject}`);
  if (context.selection) {
    lines.push(`Selected (${context.selection.lines.length} ${context.selection.noun}):`);
    for (const line of context.selection.lines) lines.push(`- ${line}`);
  } else {
    lines.push("Selected: nothing");
  }
  return `## Where the person is

They are on **${context.page}**. "This", "these", "here" and "the selected ones" refer to the record and rows below; use their ids. When they say "these" and nothing is selected, ask which ones — never guess.

${fenceUntrusted("the page the person is on", lines.join("\n"), OTHERS_TEXT_NOTE)}`;
}
