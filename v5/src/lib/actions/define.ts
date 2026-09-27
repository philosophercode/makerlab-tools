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

/** What MCP clients may do with an action (§3.8). */
export type McpExposure = "never" | "propose" | "direct";

/** What an action changes, for the card, the conflict check and audit. */
export interface ActionSubject {
  type: "user" | "email" | "maintenance_log" | "feedback" | "project" | "tool" | "pending_tool";
  id: string;
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
  | { ok: false; error: E | AdminGateError };

/** The answer every surface gets: the action's own success shape, or a code. */
export type ActionResult<R, E extends string> =
  | ({ ok: true; warning?: AdminActionWarning } & R)
  | { ok: false; error: E | AdminGateError };

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
  afterGate?: (ctx: ActionContext) => Promise<{ ok: true; warning?: AdminActionWarning } | { ok: false; error: E | AdminGateError }>;
  /**
   * Refusals beyond the permission (floor, last super admin, self-removal, an
   * unknown target), as codes. Runs at propose time too (phase 2), so it reads
   * and never writes. `run()` re-derives anything it depends on: time passes
   * between a check and a click.
   */
  check?: (input: I, ctx: ActionContext) => Promise<E | null>;
  /** The change itself, against `src/lib/data`. A throw becomes `failed`. */
  run: (input: I, ctx: ActionContext) => Promise<ActionOutcome<R, E, C>>;
  /**
   * After the change committed: audit event, mirror push, cache tags. A
   * warning at worst, never a failure — the row has already changed, and an
   * island answers a failure by restoring the value it replaced.
   */
  afterCommit?: (input: I, committed: C, ctx: ActionContext) => Promise<AdminActionWarning | undefined>;
  /** Pages to refresh once something committed. Guarded: a refresh that cannot be scheduled logs. */
  revalidate?: string[];
}

/** The MCP exposure a risk gets unless the definition says otherwise (§3.8). */
export function defaultMcpExposure(risk: ActionRisk): McpExposure {
  if (risk === "operational") return "direct";
  if (risk === "catalog") return "propose";
  return "never";
}

type Defaults = "assistant" | "mcp" | "maxBatch";

/**
 * Declare an action. Fills the defaults the spec gives (assistant "propose",
 * MCP by risk, no batch) and refuses, at module load, a definition that breaks
 * a rule no test should have to find: a destructive batch, a "never" without
 * its reason, a people/spend/destructive action exposed over MCP.
 */
export function defineAction<I, R extends object, E extends string, C = true>(
  def: Omit<ActionDefinition<I, R, E, C>, Defaults> & Partial<Pick<ActionMeta, Defaults>>
): ActionDefinition<I, R, E, C> {
  const full: ActionDefinition<I, R, E, C> = {
    ...def,
    assistant: def.assistant ?? "propose",
    mcp: def.mcp ?? defaultMcpExposure(def.risk),
    maxBatch: def.maxBatch ?? 1,
  };
  if (full.risk === "destructive" && full.maxBatch !== 1) {
    throw new Error(`[actions] ${full.id}: a destructive action never batches`);
  }
  if (full.assistant === "never" && !full.neverReason) {
    throw new Error(`[actions] ${full.id}: assistant "never" needs a neverReason`);
  }
  if (full.mcp !== "never" && defaultMcpExposure(full.risk) === "never") {
    throw new Error(`[actions] ${full.id}: ${full.risk} actions are never exposed over MCP`);
  }
  if (full.maxBatch < 1 || full.maxBatch > 20) {
    throw new Error(`[actions] ${full.id}: maxBatch must be 1–20`);
  }
  return full;
}
