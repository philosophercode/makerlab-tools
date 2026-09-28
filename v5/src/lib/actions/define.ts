import type { z } from "zod";
import type { AdminActionWarning, AdminGateError } from "../admin/action-result";
import type { Identity } from "../auth/identity";
import type { Permission } from "../auth/permissions";

/**
 * The action layer's vocabulary (assistant–GUI parity spec §3.2).
 *
 * Every write a person can make in the GUI is defined once, as data plus a
 * `run()`, and every surface — the GUI's server actions today, the assistant's
 * confirmation route and MCP from phase 2 — runs it through `performAction()`
 * (`perform.ts`). That is the whole point: one gate, one set of refusal codes,
 * one audit step, whichever surface a person used.
 *
 * Deliberately free of `"server-only"` and of any data import, so the parity
 * guard and a future client card can read the metadata without pulling a
 * database handle into their graph.
 */

/** How much a mistake costs, which decides the confirmation it needs (§3.2) and MCP's default (§3.8). */
export type ActionRisk =
  /** Queue work: ticket status, correction status. Reversible, no catalogue change. */
  | "operational"
  /** Changes what the public catalogue shows: publish, archive, fields, units, projects. */
  | "catalog"
  /** Who someone is: role, title, name, add, allowance. */
  | "people"
  /** Starts paid work: research, image retry, refresh, import suggestions. */
  | "spend"
  /** Cannot be taken back by the same person in one click: remove, delete, disconnect. */
  | "destructive";

/** Which surface a person used. Recorded on audit from phase 2 (`audit_events.surface`). */
export type ActionSurface = "gui" | "assistant" | "mcp";

/**
 * What MCP clients may do with an action (§3.8).
 *
 * `direct` (commit without a confirmation card) is never a default: the
 * owner's §11 answer 4 is "MCP gets proposals only", with `update_ticket`
 * grandfathered because MCP clients already use it. A definition that wants
 * `direct` says so explicitly, and the registry test holds the list to
 * `DIRECT_OVER_MCP`.
 */
export type McpExposure = "never" | "propose" | "direct";

/** The only actions allowed `mcp: "direct"` (§11 answer 4): today's `update_ticket`, kept working. */
export const DIRECT_OVER_MCP: readonly string[] = ["tickets.update"];

/**
 * What the assistant may never do, on any surface — chat or MCP — whatever the
 * person's role (owner decision 2026-09-27, spec amendment "Assistant limits").
 * The GUI keeps every one of these for people who hold the permission.
 *
 * Two halves, so a future action cannot slip through by being new:
 *
 * - {@link ASSISTANT_FORBIDDEN_ACTIONS}: today's registered actions the owner
 *   took away from the assistant, by id, with the reason.
 * - {@link ASSISTANT_FORBIDDEN_CATEGORIES}: whole kinds of work no assistant
 *   tool may do, matched on the words of an action's id or any tool's name.
 *   Most have no action today; the match is what stops one being exposed by
 *   accident.
 *
 * `defineAction` refuses, at module load, a matching action that is not
 * `assistant: "never"` or that carries a tool; the capability layer never
 * offers a tool whose name matches (`assistantToolForbidden`), on either
 * surface; and `proposeAction` and the confirm route refuse a matching action
 * even when a stored proposal names it (`not_offered`).
 */
export const ASSISTANT_FORBIDDEN_ACTIONS: Readonly<Record<string, string>> = {
  "people.grant_allowance": "Research allowances are granted on the People page only (owner decision 2026-09-27)",
  "people.remove": "Removing a person is done on the People page only (owner decision 2026-09-27)",
  "people.block_email": "Blocking an address is done on the People page only (owner decision 2026-09-27)",
  "people.unblock_email": "Unblocking an address is done on the People page only (owner decision 2026-09-27)",
  "mirror.disconnect": "Disconnecting the Notion mirror is done on the mirror page only (owner decision 2026-09-27)",
};

/**
 * The kinds of work no assistant tool may do, each as the words that name it.
 * An action id (`<area>.<verb>`) or a tool name (`snake_case`) is split on
 * `.`, `_` and `-`; any word in a category's list forbids it. Deliberately
 * broad: a false match costs a `neverReason`; a missed one is a leak.
 */
export const ASSISTANT_FORBIDDEN_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  /** Environment variables and secrets: reading or setting them. */
  secrets: ["env", "envs", "environment", "secret", "secrets", "credential", "credentials", "password", "passwords", "apikey"],
  /** Creating tokens or handling any other credential. */
  tokens: ["token", "tokens", "oauth", "consent"],
  /** Deploying or changing hosting settings. */
  hosting: ["deploy", "deploys", "deployment", "deployments", "redeploy", "hosting", "vercel", "domain", "domains", "dns", "rollback", "promote"],
  /** Raw SQL or direct database access. */
  database: ["sql", "db", "database", "databases", "migrate", "migration", "migrations", "raw"],
  /** Restoring backups or running `data:push`. */
  backups: ["backup", "backups", "dump", "push", "data"],
  /** Editing or deleting audit events. */
  audit: ["audit", "audits", "trail"],
  /** Sending email or any other message. */
  messaging: ["send", "mail", "message", "messages", "notify", "notification", "notifications", "sms", "slack", "invite", "invites"],
  /** Bulk-exporting people's email addresses (find_people stays masked). */
  export: ["export", "exports", "download", "csv", "email", "emails", "addresses"],
  /** Removing people, blocking or unblocking their addresses. */
  people: ["block", "unblock", "ban", "unban", "allowance", "allowances"],
};

/** The words of an action id or tool name: `people.unblock_email` → people, unblock, email. */
function wordsOf(name: string): string[] {
  return name.toLowerCase().split(/[._-]+/).filter(Boolean);
}

/** The forbidden category `name` falls in, or null. */
export function forbiddenCategoryOf(name: string): string | null {
  const words = new Set(wordsOf(name));
  for (const [category, list] of Object.entries(ASSISTANT_FORBIDDEN_CATEGORIES)) {
    if (list.some((word) => words.has(word))) return category;
  }
  return null;
}

/**
 * Why the assistant may never run this action, or null when it may. Checks the
 * id list first, then the categories against both the id and the tool name.
 */
export function assistantForbiddenReason(meta: Pick<ActionMeta, "id" | "toolName">): string | null {
  const listed = ASSISTANT_FORBIDDEN_ACTIONS[meta.id];
  if (listed) return listed;
  const category = forbiddenCategoryOf(meta.id) ?? forbiddenCategoryOf(meta.toolName);
  return category ? `The assistant never does ${category} work (owner decision 2026-09-27)` : null;
}

/** True when a capability tool of this name may never be offered to the assistant. */
export function assistantToolForbidden(toolName: string): boolean {
  return forbiddenCategoryOf(toolName) !== null;
}

/**
 * True when the assistant (chat or MCP) may propose this action at all:
 * `assistant: "propose"` and outside the deny list. Asked where tools are
 * generated, at propose time and again at the click.
 */
export function assistantMayPropose(meta: Pick<ActionMeta, "id" | "toolName" | "assistant">): boolean {
  return meta.assistant === "propose" && assistantForbiddenReason(meta) === null;
}

/**
 * What the confirmation card shows (§3.2), built from the database when the
 * proposal is made and stored with it. **Never the model's words**: the
 * summary is a next-intl key under `actions.summary` with values read from
 * rows, and every before/after is a stored value.
 */
export interface ActionPreview {
  /** `actions.summary.<key>`, and its values: names and counts, from the database. */
  summary: { key: string; values: Record<string, string | number> };
  rows: ActionPreviewRow[];
  /** The subject's name as stored — what a destructive card asks to be typed (phase 6). */
  subjectName: string;
  /** The subject's page, for a "view" link once it is done. */
  link?: string;
  /**
   * An opaque token for what the change was built from but the rows do not
   * show — an intake approval's name, brand and research. Compared at the
   * click like a row's `before`: a different token is `conflict`.
   */
  version?: string;
}

/** One changing field: `actions.fields.<field>`, before → after. */
export interface ActionPreviewRow {
  field: string;
  before: string | null;
  after: string | null;
  /**
   * The values are vocabulary, shown through `actions.values.<format>.<value>`
   * rather than as typed ("in_progress" reads "In progress").
   */
  format?: "role" | "ticketStatus" | "priority" | "correctionStatus" | "published" | "maintenanceType" | "unitStatus" | "unitCondition" | "archived";
}

/**
 * How the assistant asks for an action (§3.4): its own schema — strict,
 * described, capped, written for a model — and the step from those arguments
 * to one definition input per subject. A batch tool ("resolve these two")
 * maps to several inputs; each becomes its own proposal row, confirmed or
 * refused on its own. `toInputs` may read (resolving "me" to the caller);
 * it never writes, and an argument it cannot place answers a refusal code.
 */
export interface ActionToolShape<I> {
  schema: z.ZodType<unknown>;
  toInputs: (args: unknown, ctx: ActionContext) => Promise<{ ok: true; inputs: I[] } | { ok: false; error: string }>;
}

/** Declare an {@link ActionToolShape} with its argument type checked against its schema. */
export function toolShape<T, I>(
  schema: z.ZodType<T>,
  toInputs: (args: T, ctx: ActionContext) => Promise<{ ok: true; inputs: I[] } | { ok: false; error: string }> | { ok: true; inputs: I[] } | { ok: false; error: string }
): ActionToolShape<I> {
  return {
    schema: schema as z.ZodType<unknown>,
    toInputs: async (args, ctx) => toInputs(args as T, ctx),
  };
}

/** What an action changes, for the card, the conflict check and audit. */
export interface ActionSubject {
  type:
    | "user"
    | "email"
    | "maintenance_log"
    | "feedback"
    | "project"
    | "tool"
    | "pending_tool"
    | "unit"
    | "resource"
    | "import"
    | "mirror"
    | "usage_gap";
  id: string;
}

/**
 * The audit columns a change carries (§3.7): the surface, and the proposal a
 * card confirmed. Spread into every event an action records, so the People
 * page and a card write rows that differ in these two columns only.
 */
export function auditTrail(ctx: Pick<ActionContext, "surface" | "proposalId">): { surface: ActionSurface; proposalId: string | null } {
  return { surface: ctx.surface, proposalId: ctx.proposalId ?? null };
}

/** What every step of an action is handed. The identity is the gate's, never the input's. */
export interface ActionContext {
  identity: Identity;
  surface: ActionSurface;
  /** Set when a stored proposal is being confirmed (phase 2). */
  proposalId?: string;
}

/**
 * What `run()` answers.
 *
 * `committed` says the row changed, and carries whatever `afterCommit` needs
 * to describe it (the "from" of a role change, say). Absent, the action was a
 * no-op success — "admin → admin" — so nothing is recorded and nothing is
 * refreshed, exactly as the People page has always behaved. `warning` is for
 * the writes whose audit event is inside their own statement (a rename), so
 * only `run()` knows whether it landed.
 */
export type ActionOutcome<R, E extends string, C> =
  | { ok: true; value: R; committed?: C; warning?: AdminActionWarning }
  | ActionRefusal<E>;

/**
 * A refusal, and the two numbers a few of them carry: what is left of an
 * allowance (`daily_limit`), and how long until a rate is free again
 * (`sync_too_soon`). The pages always rendered them beside the sentence; an
 * action answers them exactly as its server action did.
 */
export type ActionRefusal<E extends string> = {
  ok: false;
  error: E | AdminGateError;
  remaining?: number;
  retryAfterSeconds?: number;
};

/**
 * The answer every surface gets: the action's own success shape, or a code.
 * A success shape that names its own `warning` (the tool editor's, which adds
 * `files_not_attached`) keeps it; every other one gets the shared audit one.
 */
export type ActionResult<R, E extends string> =
  | ({ ok: true } & ("warning" extends keyof R ? unknown : { warning?: AdminActionWarning }) & R)
  | ActionRefusal<E>;

/**
 * The parts of a definition that are data — what the parity guard, the
 * generated tools (phase 2) and `/mcp` read. Every definition is one of these.
 */
export interface ActionMeta {
  /** Stable dotted id, `<area>.<verb>`: "people.set_title". */
  id: string;
  /** The assistant's tool name (§4.9). Unique across the registry and every capability. */
  toolName: string;
  /** For the model and MCP clients. Says it proposes; nothing changes until confirmed. */
  description: string;
  /** The one permission the gate checks, on every surface. */
  permission: Permission;
  risk: ActionRisk;
  /** "propose" (default) or "never", with the reason in `neverReason`. */
  assistant: "propose" | "never";
  neverReason?: string;
  mcp: McpExposure;
  /** Up to this many subjects in one proposal; 1 for no batch. Destructive is always 1. */
  maxBatch: number;
  /**
   * Refused in a tainted turn although its risk is not `people` or
   * `destructive` (§8.4): an action that discards, like removing an import's
   * rows, proposed from the very turn that read those rows.
   */
  refuseWhenTainted?: boolean;
}

export interface ActionDefinition<I, R extends object, E extends string, C = true> extends ActionMeta {
  /**
   * The input, validated on every surface before anything but the gate runs.
   * Phase 1 keeps each schema as lenient as the server action it replaced, so
   * no GUI request that used to reach the data layer is refused earlier now.
   */
  input: z.ZodType<I>;
  /**
   * The code a parse failure answers — the action's own vocabulary
   * (`invalid_title`, `invalid_field`), so an island never meets a code it has
   * no `admin.errors.<code>` string for.
   */
  invalidInput: E;
  subject: (input: I) => ActionSubject;
  /**
   * A step owed right after the gate, before the input is even read — the
   * People page's super-admin floor reconciliation, which writes the caller's
   * own row. Its warning rides on whatever the action then answers.
   */
  afterGate?: (ctx: ActionContext) => Promise<{ ok: true; warning?: AdminActionWarning } | ActionRefusal<E>>;
  /**
   * Refusals beyond the permission (floor, last super admin, self-removal, an
   * unknown target), as codes. Runs at propose time too (phase 2), so it reads
   * and never writes. `run()` re-derives anything it depends on: time passes
   * between a check and a click.
   */
  check?: (input: I, ctx: ActionContext) => Promise<E | null>;
  /**
   * Refusals only a proposal needs, run after `check` when the assistant
   * proposes: what the click would certainly refuse (an intake item not yet
   * researched, a unit with history), so no card is drawn that can only fail.
   * Never on the GUI path, whose order of refusals stays as it was.
   */
  proposeCheck?: (input: I, ctx: ActionContext) => Promise<string | null>;
  /** The change itself, against `src/lib/data`. A throw becomes `failed`. */
  run: (input: I, ctx: ActionContext) => Promise<ActionOutcome<R, E, C>>;
  /**
   * After the change committed: audit event, mirror push, cache tags. A
   * warning at worst, never a failure — the row has already changed, and an
   * island answers a failure by restoring the value it replaced.
   */
  afterCommit?: (input: I, committed: C, ctx: ActionContext) => Promise<AdminActionWarning | undefined>;
  /**
   * Pages to refresh once something committed — a list, or one built from the
   * input (an intake item's own page). Guarded: a refresh that cannot be
   * scheduled logs.
   */
  revalidate?: string[] | ((input: I) => string[]);
  /**
   * The card's before → after, read from the database (§3.2). Runs at propose
   * time after `check`; null means the subject is not there (`not_found`).
   * Required of every action the assistant proposes (`parity.test.ts`).
   */
  preview?: (input: I, ctx: ActionContext) => Promise<ActionPreview | null>;
  /** The assistant's tool arguments and how they become inputs (§3.4). */
  tool?: ActionToolShape<I>;
}

/**
 * The MCP exposure a risk gets unless the definition says otherwise (§3.8, as
 * narrowed by §11 answer 4): proposals for queue and catalogue work, nothing
 * for people, spend or destructive actions. Never `direct`.
 */
export function defaultMcpExposure(risk: ActionRisk): McpExposure {
  if (risk === "operational" || risk === "catalog") return "propose";
  return "never";
}

type Defaults = "assistant" | "mcp" | "maxBatch";

/**
 * Declare an action. Fills the defaults the spec gives (assistant "propose",
 * MCP by risk, no batch) and refuses, at module load, a definition that breaks
 * a rule no test should have to find: a destructive batch, a "never" without
 * its reason, a people/spend/destructive action exposed over MCP, a `direct`
 * MCP exposure outside `DIRECT_OVER_MCP`, an action on the assistant's deny
 * list that is not "never", and a "never" that still carries a tool.
 */
export function defineAction<I, R extends object, E extends string, C = true>(
  def: Omit<ActionDefinition<I, R, E, C>, Defaults> & Partial<Pick<ActionMeta, Defaults>>
): ActionDefinition<I, R, E, C> {
  const full: ActionDefinition<I, R, E, C> = {
    ...def,
    assistant: def.assistant ?? "propose",
    // What the assistant may never propose, an MCP client may not either.
    // Nor one refused on a tainted turn: MCP has no taint tracking.
    mcp: def.mcp ?? (def.assistant === "never" || def.refuseWhenTainted ? "never" : defaultMcpExposure(def.risk)),
    maxBatch: def.maxBatch ?? 1,
  };
  if (full.risk === "destructive" && full.maxBatch !== 1) {
    throw new Error(`[actions] ${full.id}: a destructive action never batches`);
  }
  if (full.assistant === "never" && !full.neverReason) {
    throw new Error(`[actions] ${full.id}: assistant "never" needs a neverReason`);
  }
  if (full.assistant === "never" && full.mcp !== "never") {
    throw new Error(`[actions] ${full.id}: an action the assistant never proposes is never exposed over MCP`);
  }
  if (full.refuseWhenTainted && full.mcp !== "never") {
    throw new Error(`[actions] ${full.id}: a refuseWhenTainted action is never exposed over MCP (no taint tracking there)`);
  }
  if (full.mcp !== "never" && defaultMcpExposure(full.risk) === "never") {
    throw new Error(`[actions] ${full.id}: ${full.risk} actions are never exposed over MCP`);
  }
  if (full.mcp === "direct" && !DIRECT_OVER_MCP.includes(full.id)) {
    throw new Error(`[actions] ${full.id}: MCP gets proposals only; "direct" is kept for ${DIRECT_OVER_MCP.join(", ")}`);
  }
  const forbidden = assistantForbiddenReason(full);
  if (forbidden && full.assistant !== "never") {
    throw new Error(`[actions] ${full.id}: the assistant may never offer this — mark it assistant "never" (${forbidden})`);
  }
  if (full.assistant === "never" && (full.tool || full.preview)) {
    throw new Error(`[actions] ${full.id}: an action the assistant never proposes carries no tool and no preview`);
  }
  if (full.maxBatch < 1 || full.maxBatch > 20) {
    throw new Error(`[actions] ${full.id}: maxBatch must be 1–20`);
  }
  return full;
}
