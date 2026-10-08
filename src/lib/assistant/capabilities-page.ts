import {
  ASSISTANT_FORBIDDEN_ACTIONS,
  ASSISTANT_FORBIDDEN_CATEGORIES,
  assistantMayPropose,
  type ActionMeta,
} from "../actions/define";
import { EXA_SEARCH_TOOL } from "../ai/exa";
import type { Role } from "../auth/roles";
import { capabilitiesForIdentity } from "../capabilities/access";
import { audienceOf, type McpAudience } from "../capabilities/mcp-catalog";
import type { Capability, CapabilityTool } from "../capabilities/types";
import { OUTSIDE_CONTENT_TOOLS } from "../chat/taint";

/**
 * What MakerLAB AI can and can't do, as data for the public `/assistant` page
 * (assistant–GUI parity spec, amendment 2026-09-29 "The capabilities page").
 *
 * **Generated, never hand-listed.** Every row comes from the two registries
 * the assistant itself is built from — the capability tools
 * (`lib/capabilities`) and the action definitions (`lib/actions/registry.ts`)
 * — and who gets it is asked of the same gates the chat and MCP ask
 * (`capabilitiesForIdentity`, `mcpToolAllowed`), with a stand-in caller per
 * role. The "never" list is the deny list in `lib/actions/define.ts`. So a new
 * action or tool appears here the day it is registered, and an action the
 * owner takes away moves to "never" the day it is.
 *
 * What is written by hand is only the human words: each row's label and each
 * "never" line's reason (`assistantPage` in `messages/en.json`), and which
 * area a row sits in. `capabilities-page.test.ts` fails on a row with no
 * label or no area, so neither can be forgotten.
 *
 * Pure: takes the registries as arguments, no database, no `server-only`.
 */

/** The roles the page shows, least access first. `anonymous` is a visitor who has not signed in. */
export const PAGE_ROLES = ["anonymous", "user", "admin", "super_admin"] as const satisfies readonly Role[];
export type PageRole = (typeof PAGE_ROLES)[number];

/** The page's groups, in reading order. */
export const AREAS = [
  "catalog",
  "maintenance",
  "corrections",
  "projects",
  "intake",
  "taxonomy",
  "people",
  "insights",
  "mirror",
] as const;
export type AreaId = (typeof AREAS)[number];

/**
 * What a row is:
 * - `read` — it answers from this (a read tool);
 * - `record` — it files something itself: a report, a draft, a pending item, a
 *   field proposal staff review — never a change to what is published;
 * - `propose` — it prepares a change on a confirmation card, and nothing
 *   changes until the person presses Confirm;
 * - `pageOnly` — a change the app makes on its page, which the assistant does
 *   not offer (an action with `assistant: "never"` outside the deny list).
 */
export type ItemKind = "read" | "record" | "propose" | "pageOnly";

/**
 * What an outside AI connected over MCP gets:
 * `read`, `record` (files it), `inbox` (stores a proposal that waits in
 * `/admin/proposals`), `direct` (changes it — `update_ticket` only), `none`.
 */
export type McpMode = "read" | "record" | "inbox" | "direct" | "none";

/** The notes a row carries beside its label. */
export type ItemFlag =
  /** Spends the lab's research allowance (risk `spend`). */
  | "spend"
  /** Cannot be undone: one at a time, the name typed on the card (risk `destructive`). */
  | "typedName"
  /** Several records on one card (`maxBatch` > 1). */
  | "batch"
  /** Refused in a turn that read outside text (§8.4): people, destructive, `refuseWhenTainted`. */
  | "notAfterOutside"
  /** Reading it counts as outside text for the rest of the turn. */
  | "outsideText"
  /** User ↔ Admin only; anything involving super admin is the People page's. */
  | "notSuperAdmin";

export interface CapabilityItem {
  /** Unique: `action:<id>` or `tool:<name>`. */
  key: string;
  /** Under `assistantPage`: `actions.<id with _>` or `tools.<name>`. */
  labelKey: string;
  /** The tool name a model sees (for an action, its tool's name). */
  toolName: string;
  /** Set for a row generated from an action definition. */
  actionId?: string;
  area: AreaId;
  kind: ItemKind;
  /** Offered in the chat to each role. */
  chat: Record<PageRole, boolean>;
  mcp: McpMode;
  /** The least-privileged audience MCP offers it to, or null when `mcp` is `none`. */
  mcpAudience: McpAudience | null;
  flags: ItemFlag[];
  /** Up to this many records on one card. */
  maxBatch: number;
  /** For `pageOnly`: `pageOnly.<id with _>`, why it stays on its page. */
  reasonKey?: string;
}

/** One line of "never, on any surface, whatever the role". */
export interface NeverItem {
  /** `rule:super_admin`, `action:<id>` or `category:<name>`. */
  key: string;
  /** Under `assistantPage.never`: `<id with _>` / `category_<name>` / `super_admin`; the reason is `<same>Why`. */
  labelKey: string;
  /** For a category: the words that make a tool or action name refused. */
  words?: readonly string[];
  /** For a forbidden action that is registered: its tool name (never offered). */
  toolName?: string;
}

export interface AssistantCapabilities {
  items: CapabilityItem[];
  never: NeverItem[];
}

/**
 * The area a registered action sits in, by its id's first word
 * (`tickets.update` → maintenance). The test fails on an area nobody mapped.
 */
export const ACTION_AREAS: Readonly<Record<string, AreaId>> = {
  people: "people",
  tickets: "maintenance",
  schedules: "maintenance",
  corrections: "corrections",
  projects: "projects",
  tools: "catalog",
  units: "catalog",
  resources: "catalog",
  manuals: "catalog",
  pending: "intake",
  imports: "intake",
  refresh: "intake",
  mirror: "mirror",
  taxonomy: "taxonomy",
  insights: "insights",
  // The lab-wide notes (identity spec amendment "Lab notes"): what the assistant knows about the lab.
  lab: "catalog",
};

/** The area of each capability tool that is not an action's, and of the chat's web search. */
export const TOOL_AREAS: Readonly<Record<string, AreaId>> = {
  list_tools: "catalog",
  search_tools: "catalog",
  get_tool_details: "catalog",
  get_tool_qr_code: "catalog",
  show_tool: "catalog",
  make_illustration: "projects",
  suggest_replies: "catalog",
  get_unit_details: "catalog",
  get_tool_units: "catalog",
  search_manual: "catalog",
  read_page: "catalog",
  [EXA_SEARCH_TOOL]: "catalog",
  propose_change: "catalog",
  get_maintenance_history: "maintenance",
  report_issue: "maintenance",
  list_open_tickets: "maintenance",
  list_maintenance_due: "maintenance",
  list_my_reports: "maintenance",
  report_correction: "corrections",
  list_corrections: "corrections",
  list_project_queue: "projects",
  identify_tools: "intake",
  start_import: "intake",
  create_tool: "intake",
  list_intake_queue: "intake",
  list_imports: "intake",
  list_categories: "taxonomy",
  list_category_proposals: "taxonomy",
  find_people: "people",
  get_value_report: "insights",
  get_usage_summary: "insights",
};

/**
 * The actions whose chat tool refuses a super-admin change on any surface but
 * the People page (`superAdminPageOnly`, `lib/actions/people.ts`): the deny
 * list's first row, which is a rule on these two rather than an action of its own.
 */
export const SUPER_ADMIN_GUARDED: readonly string[] = ["people.set_role", "people.add"];

/** The capability id whose tools are generated from the action registry. */
const ACTIONS_CAPABILITY = "actions";

/** `people.set_role` → `people_set_role`: next-intl keys cannot hold a dot. */
export function keyOf(id: string): string {
  return id.replace(/\./g, "_");
}

function areaOfAction(id: string): AreaId {
  return ACTION_AREAS[id.split(".")[0]] ?? "catalog";
}

function areaOfTool(name: string): AreaId {
  return TOOL_AREAS[name] ?? "catalog";
}

/** Every chat tool name each role is offered, through the chat's own gate. */
function chatToolsByRole(capabilities: Capability[]): Record<PageRole, Set<string>> {
  const out = {} as Record<PageRole, Set<string>>;
  for (const role of PAGE_ROLES) {
    const names = new Set<string>();
    for (const capability of capabilitiesForIdentity(capabilities, { role })) {
      for (const tool of capability.tools) if (!tool.mcpOnly) names.add(tool.name);
    }
    out[role] = names;
  }
  return out;
}

const AUDIENCE_RANK: Record<McpAudience, number> = { anyone: 0, signed_in: 1, staff: 2 };

/** The least-privileged MCP audience of any registered tool named `name`, or null. */
function mcpAudienceOf(capabilities: Capability[], name: string): McpAudience | null {
  let best: McpAudience | null = null;
  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      if (tool.name !== name) continue;
      const audience = audienceOf(capability, tool);
      if (audience && (best === null || AUDIENCE_RANK[audience] < AUDIENCE_RANK[best])) best = audience;
    }
  }
  return best;
}

function rolesRecord(names: Record<PageRole, Set<string>>, name: string): Record<PageRole, boolean> {
  return Object.fromEntries(PAGE_ROLES.map((role) => [role, names[role].has(name)])) as Record<PageRole, boolean>;
}

const NO_ROLE: Record<PageRole, boolean> = { anonymous: false, user: false, admin: false, super_admin: false };

function actionFlags(def: ActionMeta): ItemFlag[] {
  const flags: ItemFlag[] = [];
  if (def.risk === "spend") flags.push("spend");
  if (def.risk === "destructive") flags.push("typedName");
  if (def.maxBatch > 1) flags.push("batch");
  if (def.risk === "people" || def.risk === "destructive" || def.refuseWhenTainted) flags.push("notAfterOutside");
  if (SUPER_ADMIN_GUARDED.includes(def.id)) flags.push("notSuperAdmin");
  return flags;
}

/** Build the page's rows from the registries. */
export function buildAssistantCapabilities(
  capabilities: Capability[],
  definitions: readonly ActionMeta[]
): AssistantCapabilities {
  const chat = chatToolsByRole(capabilities);
  const actionToolNames = new Set(definitions.map((def) => def.toolName));
  const items: CapabilityItem[] = [];

  // Capability tools that are not an action's — reads, and the writes that file
  // something. A tool sharing an action's name (MCP's direct `update_ticket`)
  // is that action's MCP door, and folds into its row below.
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (capability.id === ACTIONS_CAPABILITY) continue;
    for (const tool of capability.tools as CapabilityTool<unknown, unknown>[]) {
      if (actionToolNames.has(tool.name) || seen.has(tool.name)) continue;
      seen.add(tool.name);
      const audience = mcpAudienceOf(capabilities, tool.name);
      items.push({
        key: `tool:${tool.name}`,
        labelKey: `tools.${tool.name}`,
        toolName: tool.name,
        area: areaOfTool(tool.name),
        kind: tool.kind === "read" ? "read" : "record",
        chat: rolesRecord(chat, tool.name),
        mcp: audience ? (tool.kind === "read" ? "read" : "record") : "none",
        mcpAudience: audience,
        flags: OUTSIDE_CONTENT_TOOLS.includes(tool.name) ? ["outsideText"] : [],
        maxBatch: 1,
      });
    }
  }

  // The chat's web search: added beside the registry by the chat route for
  // every caller, never over MCP (`app/api/chat/route.ts`).
  items.push({
    key: `tool:${EXA_SEARCH_TOOL}`,
    labelKey: `tools.${EXA_SEARCH_TOOL}`,
    toolName: EXA_SEARCH_TOOL,
    area: areaOfTool(EXA_SEARCH_TOOL),
    kind: "read",
    chat: { anonymous: true, user: true, admin: true, super_admin: true },
    mcp: "none",
    mcpAudience: null,
    flags: ["outsideText"],
    maxBatch: 1,
  });

  const never: NeverItem[] = [{ key: "rule:super_admin", labelKey: "super_admin" }];

  for (const def of definitions) {
    if (ASSISTANT_FORBIDDEN_ACTIONS[def.id]) continue; // listed under "never" below
    const proposable = assistantMayPropose(def);
    const audience = proposable ? mcpAudienceOf(capabilities, def.toolName) : null;
    items.push({
      key: `action:${def.id}`,
      labelKey: `actions.${keyOf(def.id)}`,
      toolName: def.toolName,
      actionId: def.id,
      area: areaOfAction(def.id),
      kind: proposable ? "propose" : "pageOnly",
      chat: proposable ? rolesRecord(chat, def.toolName) : NO_ROLE,
      mcp: audience ? (def.mcp === "direct" ? "direct" : "inbox") : "none",
      mcpAudience: audience,
      flags: proposable ? actionFlags(def) : [],
      maxBatch: def.maxBatch,
      ...(proposable ? {} : { reasonKey: `pageOnly.${keyOf(def.id)}` }),
    });
  }

  const registered = new Map(definitions.map((def) => [def.id, def]));
  for (const id of Object.keys(ASSISTANT_FORBIDDEN_ACTIONS)) {
    const def = registered.get(id);
    never.push({ key: `action:${id}`, labelKey: keyOf(id), ...(def ? { toolName: def.toolName } : {}) });
  }
  for (const [category, words] of Object.entries(ASSISTANT_FORBIDDEN_CATEGORIES)) {
    never.push({ key: `category:${category}`, labelKey: `category_${category}`, words });
  }

  const kindOrder: Record<ItemKind, number> = { read: 0, record: 1, propose: 2, pageOnly: 3 };
  items.sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area) || kindOrder[a.kind] - kindOrder[b.kind]);
  return { items, never };
}

/** What `role` gets in the chat, counted — the page's "for you" line. */
export function summaryFor(data: AssistantCapabilities, role: PageRole) {
  const mine = data.items.filter((item) => item.chat[role]);
  return {
    reads: mine.filter((item) => item.kind === "read").length,
    records: mine.filter((item) => item.kind === "record").length,
    proposes: mine.filter((item) => item.kind === "propose").length,
    spend: mine.filter((item) => item.flags.includes("spend")).length,
    typedName: mine.filter((item) => item.flags.includes("typedName")).length,
  };
}

/** The page role a viewer's role stands for (every role is one today). */
export function pageRoleOf(role: Role): PageRole {
  return (PAGE_ROLES as readonly string[]).includes(role) ? (role as PageRole) : "anonymous";
}
