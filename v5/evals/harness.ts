import {
  CAPABILITIES,
  capabilitiesForIdentity,
  composeChat,
  type CapabilityCtx,
} from "@/lib/capabilities";
import { stubLiveReads, stubWrites } from "@/lib/chat/headless-stubs";
import { getCatalogTool, getCatalogTools } from "@/lib/catalog";
import { loadToolManualsForChat } from "@/lib/chat/tool-manuals";
import {
  appendManualSections,
  attachedManualLinks,
  collectToolManuals,
  pickPdfSource,
  type AttachedManual,
} from "@/lib/chat/attached-manuals";
import { listResourcesForTool } from "@/lib/data/resources";
import type { AttachedManualLink } from "@/lib/manuals/attached-citations";
import type { ModelMessage, Tool } from "ai";
import type { Identity } from "@/lib/auth/identity";
import { curationCapability } from "@/lib/capabilities/curation";
import type { CurationContext } from "@/lib/capabilities/types";
import { DEMO_ACCOUNTS } from "@/lib/db/demo-seed";
import { loadCurationSubject, recordFields } from "@/lib/refresh/curation";
import { loadPageContext, pageContextSection, PAGE_CONTEXTS } from "@/lib/actions/page-context";
import { getDb } from "@/lib/db/client";
import { feedback, maintenanceLogs, pendingTools, projects, tools as toolsTable } from "@/lib/db/schema/index";
import { inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PHOTOS_DIR, type EvalCaller, type EvalCase, type EvalTurn } from "./cases";

/**
 * The bridge between a case and the assistant (design spec §3).
 *
 * Everything here except the model call: resolve the fixture catalogue, focus
 * the machine the case is asked from, stub the write tools, and compose the
 * system prompt and tool set **through the same registry and the same
 * `composeChat` that `/api/chat` uses**. An eval that tested a reimplementation
 * of the prompt would test nothing, so nothing in this file assembles a prompt
 * of its own.
 *
 * Split out from `run.eval.ts` so it can be tested offline, with no API key —
 * the model call is the only part that cannot be.
 */

// The write and live-read stubs live beside the app's own headless runner
// (starter answers) so both use one definition; re-exported for the eval.
export { stubLiveReads, stubWrites };

/** What the assistant is given for one case. */
export interface ComposedCase {
  system: string;
  tools: Record<string, Tool>;
  /**
   * The focused tool's manuals attached whole (no searchable text), with their
   * bytes — attach them to the messages with `attachManualsToFirstUserMessage`,
   * as the route does.
   */
  manuals: AttachedManual[];
  /**
   * What the route streams about those manuals as `data-manual-links` — title,
   * stored address, ref, page count — for `citations_resolve`, as the
   * search results' passages are captured from the tool calls.
   */
  attachedManuals: AttachedManualLink[];
}

/**
 * The focused tool's manuals the route would attach whole
 * (`lib/chat/attached-manuals.ts`), limited to the lab's own store: a
 * resource whose PDF is only a link on the web is left out, so an eval never
 * fetches from the live network (design spec §8). The fixture's attached
 * manual (`manual-fixture.ts`) is an upload on the eval's local blob origin.
 */
async function attachedManualsFor(toolId: string, searchable: ReadonlySet<string>): Promise<AttachedManual[]> {
  const ownStore = (await listResourcesForTool(toolId)).filter((r) => pickPdfSource(r)?.ownStore !== false);
  return (await collectToolManuals(ownStore, searchable)).manuals;
}

/**
 * Build the system prompt and tool set for a case, exactly as the chat route
 * would for a student asking the same question from the same page.
 */
export async function composeCase(evalCase: EvalCase): Promise<ComposedCase> {
  const tools = await getCatalogTools();
  const focused = evalCase.context.toolId
    ? await getCatalogTool(evalCase.context.toolId)
    : null;
  if (evalCase.context.toolId && !focused) {
    throw new Error(
      `case "${evalCase.id}" focuses toolId "${evalCase.context.toolId}", which is not in the fixture catalog`
    );
  }

  // A curation case (refresh research spec §12): the tool's record, as the
  // chat route loads it for staff; `propose_change` is a write and is stubbed.
  const curation = evalCase.context.curate && focused ? await curationFor(focused.id) : null;
  const identity = evalCase.context.as ? evalIdentity(evalCase.context.as) : undefined;
  const ctx: CapabilityCtx = {
    locale: "en",
    focusedToolId: focused?.id,
    ...(curation ? { curation } : {}),
    ...(identity ? { identity } : {}),
  };
  // The focused tool's searchable manuals, as the chat route loads them — the
  // eval's fixture manual (`manual-fixture.ts`) once `npm run eval` seeded it,
  // nothing offline. `search_manual` itself stays live: it reads the eval's
  // own PGlite database and nothing else.
  const toolManuals = focused ? await loadToolManualsForChat(focused.id, null) : null;
  const manualOutlines = toolManuals?.outlines ?? [];
  // The rest of its PDF manuals, attached whole, as the route attaches them.
  const manuals = focused && toolManuals ? await attachedManualsFor(focused.id, toolManuals.searchableResourceIds) : [];
  const capabilities = curation ? [...CAPABILITIES, curationCapability("tool")] : CAPABILITIES;
  // A case that names its caller gets that caller's registry, through the same
  // `capabilitiesForIdentity` the route uses; one that does not keeps the
  // historical, unfiltered composition.
  const permitted = identity ? capabilitiesForIdentity(capabilities, identity) : capabilities;
  const composed = composeChat(stubLiveReads(stubWrites(permitted)), ctx, {
    tools,
    focusedTool: focused,
    locale: "en",
    manualOutlines,
    ...(curation ? { curation } : {}),
  });

  // Where the person is (§10.1): the same loader and block the chat route uses.
  const page = evalCase.context.path && identity ? await pageBlock(identity, evalCase.context.path, evalCase.context.selection) : "";
  return {
    system: [appendManualSections(composed.system, focused, manuals), page].filter(Boolean).join("\n\n"),
    tools: composed.tools,
    manuals,
    attachedManuals: attachedManualLinks(manuals),
  };
}

/** The selectable table for each selection kind, and the column its rows are named by. */
async function idsByName(kind: string, names: string[]): Promise<string[]> {
  const db = await getDb();
  if (kind === "maintenance_log") {
    const rows = await db.select({ id: maintenanceLogs.id, name: maintenanceLogs.title }).from(maintenanceLogs).where(inArray(maintenanceLogs.title, names));
    return rows.map((row) => row.id);
  }
  if (kind === "feedback") {
    const rows = await db.select({ id: feedback.id }).from(feedback).where(inArray(feedback.issueDescription, names));
    return rows.map((row) => row.id);
  }
  if (kind === "project") {
    const rows = await db.select({ id: projects.id }).from(projects).where(inArray(projects.title, names));
    return rows.map((row) => row.id);
  }
  if (kind === "pending_tool") {
    const rows = await db.select({ id: pendingTools.id }).from(pendingTools).where(inArray(pendingTools.name, names));
    return rows.map((row) => row.id);
  }
  if (kind === "tool") {
    const rows = await db.select({ id: toolsTable.id }).from(toolsTable).where(inArray(toolsTable.name, names));
    return rows.map((row) => row.id);
  }
  return [];
}

/** The "Where the person is" block for a case, its selection named as the page names rows. */
async function pageBlock(identity: Identity, path: string, selection?: string[]): Promise<string> {
  const kind = PAGE_CONTEXTS.find((entry) => entry.pattern.test(path))?.selection?.kind;
  const ids = kind && selection?.length ? await idsByName(kind, selection) : [];
  if (selection?.length && ids.length !== selection.length) {
    throw new Error(`context.selection ${JSON.stringify(selection)} did not all resolve on ${path}`);
  }
  return pageContextSection(await loadPageContext(identity, { path, ...(kind && ids.length ? { selection: { kind, ids } } : {}) }));
}

/**
 * The signed-in person a case asks as: the demo seed's student or SuperMaker,
 * as `resolveIdentity` would return them. Writes are stubbed, so the ids are
 * only ever read.
 */
export function evalIdentity(caller: EvalCaller): Identity {
  const account = caller === "super_admin" ? DEMO_ACCOUNTS.superAdmin : caller === "staff" ? DEMO_ACCOUNTS.admin : DEMO_ACCOUNTS.user;
  return {
    role: account.role,
    userId: account.id,
    email: account.email,
    name: account.name,
    rateLimitKey: account.id,
  };
}

/**
 * The attachment id a case's nth photo is sent under — fixed, so an assertion
 * can name it. Writes are stubbed, so nothing ever claims it.
 */
export function evalPhotoId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/** The conversation a case sends: its history, oldest first, then its prompt. */
export function caseMessages(evalCase: EvalCase): ModelMessage[] {
  const turns: EvalTurn[] = [...(evalCase.history ?? []), { role: "user", text: evalCase.prompt }];
  const messages = turns.map((turn): ModelMessage =>
    turn.role === "user" ? { role: "user", content: turn.text } : { role: "assistant", content: turn.text }
  );
  if (!evalCase.photos?.length) return messages;

  // The final message carries its photos the way ChatPanel sends them: the
  // text with the `[Attached photos: …]` hint, then one image part each.
  const hint = evalCase.photos.map((name, index) => `attachment_id=${evalPhotoId(index)} name=${name}`).join("; ");
  messages[messages.length - 1] = {
    role: "user",
    content: [
      { type: "text", text: `${evalCase.prompt}\n\n[Attached photos: ${hint}]` },
      ...evalCase.photos.map((name) => ({
        type: "file" as const,
        mediaType: "image/jpeg",
        filename: name,
        data: readFileSync(path.join(PHOTOS_DIR, name)),
      })),
    ],
  };
  return messages;
}

/** The focused tool's record for a curation case, shaped as the chat route shapes it. */
async function curationFor(toolId: string): Promise<CurationContext | null> {
  const subject = await loadCurationSubject("tool", toolId);
  if (!subject) return null;
  return {
    kind: "tool",
    id: subject.id,
    name: subject.name,
    revision: subject.revision,
    fields: recordFields(subject.record),
    sources: subject.sources,
  };
}
