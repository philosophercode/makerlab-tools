import "server-only";

import { randomUUID } from "node:crypto";
import type { Identity } from "../auth/identity";
import { can } from "../auth/permissions";
import {
  cancelActionProposals,
  claimActionProposals,
  countOpenProposals,
  createActionProposals,
  getActionProposals,
  MAX_OPEN_PROPOSALS,
  settleActionProposal,
  type ActionProposalRecord,
} from "../data/action-proposals";
import type { ActionProposalSurface } from "../db/schema/vocabulary";
import { checkRateLimit } from "../rate-limit";
import { assistantMayPropose, type ActionContext, type ActionPreview } from "./define";
import { performAction } from "./perform";
import { actionById, type AnyActionDefinition } from "./registry";
import { driftedFields, type DriftedField } from "./staleness";
import { typedMatches } from "./typed-confirm";

/**
 * Proposing and confirming (assistant–GUI parity spec §3.4, §3.5): the
 * assistant's half and the person's half of every assistant write.
 *
 * **`proposeAction`** is what a generated tool's `run()` does. It checks — the
 * `assistantPropose` limiter, the permission, the tool's arguments, the
 * definition's own input schema, `check`, and `preview` — and stores what
 * passed as `action_proposals` rows. **It never runs the action.** Nothing
 * here can change a user, a ticket or a project.
 *
 * **`decideActionProposals`** is the confirm route's body. It runs each
 * stored row through `performAction` — the one path the GUI's server actions
 * take — with the **stored** input and the confirming person's identity, so
 * the permission, the floor, the limiter and every refusal are checked again
 * at the moment of the click (§3.5 step 5), and the audit row names the
 * person who clicked with `surface: assistant`.
 *
 * Both halves refuse an action the assistant may never run (`not_offered`,
 * `assistantMayPropose` in `define.ts`), so a stored proposal for an action
 * taken off the assistant later can never be confirmed.
 */

// ── Propose ──────────────────────────────────────────────────────────

export interface ProposeContext {
  identity: Identity;
  surface: ActionProposalSurface;
  chatId: string | null;
  /**
   * The turn read text from outside the lab's staff (§8.4). Stored on every
   * row it proposes, and a `people` or `destructive` action (or one marked
   * `refuseWhenTainted`) is refused outright (`tainted_turn`) before anything
   * is read.
   */
  tainted?: boolean;
}

/** The risks a tainted turn may never propose (§8.4). */
export const TAINT_REFUSED_RISKS: readonly string[] = ["people", "destructive"];

/** An item of a batch that was refused while the rest were proposed. */
export interface RefusedItem {
  subjectId: string;
  error: string;
}

export type ProposeResult =
  | { ok: true; groupId: string; proposals: ActionProposalRecord[]; refused: RefusedItem[] }
  | { ok: false; error: string; refused?: RefusedItem[] };

export async function proposeAction(def: AnyActionDefinition, args: unknown, ctx: ProposeContext): Promise<ProposeResult> {
  const { identity } = ctx;
  if (identity.role === "anonymous" || !identity.userId) return { ok: false, error: "not_signed_in" };
  // Before any read (Article 4).
  const limit = await checkRateLimit("assistantPropose", identity);
  if (!limit.allowed) return { ok: false, error: "rate_limited" };
  // The tool was offered by this permission; asked again, because a turn can
  // outlive a role change.
  if (!can(identity, def.permission)) return { ok: false, error: "not_permitted" };
  // Never the assistant's (owner decision 2026-09-27) — whatever built this call.
  if (!assistantMayPropose(def) || !def.tool || !def.preview) return { ok: false, error: "not_offered" };
  if (ctx.tainted && (TAINT_REFUSED_RISKS.includes(def.risk) || def.refuseWhenTainted)) return { ok: false, error: "tainted_turn" };

  const parsedArgs = def.tool.schema.safeParse(args);
  if (!parsedArgs.success) return { ok: false, error: "invalid_input" };
  const actionCtx: ActionContext = { identity, surface: ctx.surface };
  const mapped = await def.tool.toInputs(parsedArgs.data, actionCtx);
  if (!mapped.ok) return { ok: false, error: mapped.error };
  if (mapped.inputs.length === 0) return { ok: false, error: "nothing_to_change" };
  if (mapped.inputs.length > def.maxBatch) return { ok: false, error: "too_many" };

  const open = await countOpenProposals(identity.userId, { surface: ctx.surface });
  if (open + mapped.inputs.length > MAX_OPEN_PROPOSALS) return { ok: false, error: "too_many_open" };

  const groupId = randomUUID();
  const accepted: { input: unknown; preview: ActionPreview; subjectId: string; subjectType: string }[] = [];
  const refused: RefusedItem[] = [];
  const seen = new Set<string>();
  for (const raw of mapped.inputs) {
    const parsed = def.input.safeParse(raw);
    if (!parsed.success) {
      refused.push({ subjectId: "", error: def.invalidInput });
      continue;
    }
    const input = parsed.data;
    const subject = def.subject(input);
    // "Resolve these" with a ticket named twice is one change, not two cards.
    if (seen.has(subject.id)) continue;
    seen.add(subject.id);
    const refusal = (def.check ? await def.check(input, actionCtx) : null) ?? (def.proposeCheck ? await def.proposeCheck(input, actionCtx) : null);
    if (refusal) {
      refused.push({ subjectId: subject.id, error: refusal });
      continue;
    }
    const preview = await def.preview(input, actionCtx);
    if (!preview) {
      refused.push({ subjectId: subject.id, error: "not_found" });
      continue;
    }
    accepted.push({ input, preview, subjectId: subject.id, subjectType: subject.type });
  }
  if (accepted.length === 0) return { ok: false, error: refused[0]?.error ?? "nothing_to_change", refused };

  const proposals = await createActionProposals(
    accepted.map((item) => ({
      groupId,
      actionId: def.id,
      // The parsed input: what performAction will parse again at confirm.
      input: item.input,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      preview: item.preview as unknown as Record<string, unknown>,
      surface: ctx.surface,
      chatId: ctx.chatId,
      tainted: ctx.tainted === true,
      createdBy: identity.userId as string,
    }))
  );
  return { ok: true, groupId, proposals, refused };
}

// ── Confirm / cancel ─────────────────────────────────────────────────

export type ProposalOutcomeStatus =
  | "confirmed"
  | "failed"
  | "conflict"
  | "cancelled"
  | "expired"
  | "already_decided"
  | "not_found"
  /** Not reached before the request's time budget ran out; still open, nothing changed. */
  | "open";

export interface ProposalOutcome {
  id: string;
  status: ProposalOutcomeStatus;
  error?: string;
  warning?: string;
  /** The subject's page, once something was done there. */
  link?: string;
  /** For a `conflict`: each field the card showed that has changed since, and its value now. */
  drifted?: DriftedField[];
}

export interface DecideRequest {
  ids: readonly string[];
  decision: "confirm" | "cancel";
  /** For a destructive card: the subject's name as the person typed it (§5.4). */
  typed?: string;
}

/**
 * How long one confirm request may spend running rows before it stops and
 * leaves the rest open. Well inside the route's `maxDuration` (30 s), so the
 * function is never killed between claiming a row and settling it.
 */
export const CONFIRM_BUDGET_MS = 20_000;

/**
 * Decide `request.ids` as `identity`. The identity is the route's — the
 * session cookie, never a token — and only rows that identity created are
 * touched. Rows are **claimed and run one at a time**, in the order they were
 * proposed; each answers for itself, so one refusal in a batch leaves the
 * rest confirmed, and a request that runs out of time leaves the rows it has
 * not reached open (answered `open`) rather than claimed and stranded.
 */
export async function decideActionProposals(
  request: DecideRequest,
  identity: Identity,
  options: { budgetMs?: number; now?: () => number } = {}
): Promise<ProposalOutcome[]> {
  const userId = identity.userId;
  if (!userId) return request.ids.map((id) => ({ id, status: "not_found" as const }));
  const ids = [...new Set(request.ids)];

  if (request.decision === "cancel") {
    const cancelled = new Set(await cancelActionProposals(ids, userId));
    const others = await explainUnclaimed(ids.filter((id) => !cancelled.has(id)), userId);
    return ids.map((id) => (cancelled.has(id) ? { id, status: "cancelled" as const } : others.get(id)!));
  }

  // Only this person's rows that are still open take part in anything below:
  // another person's id, destructive or not, answers `not_found` like an id
  // that names nothing, and never blocks this person's batch (§11 answer 11).
  const own = (await getActionProposals(ids)).filter((row) => row.createdBy === userId && row.status === "open" && !row.expired);

  // A destructive proposal is confirmed alone, with its subject's name typed.
  // Checked before anything is claimed, so a refused click leaves it open.
  const destructive = own.filter((row) => actionById(row.actionId)?.risk === "destructive");
  if (destructive.length > 0) {
    const typedOk =
      ids.length === 1 && destructive.length === 1 && typedMatches(request.typed, String(destructive[0].preview.subjectName ?? ""));
    if (!typedOk) {
      const destructiveIds = new Set(destructive.map((row) => row.id));
      const others = await explainUnclaimed(ids.filter((id) => !destructiveIds.has(id)), userId);
      return ids.map((id) =>
        destructiveIds.has(id)
          ? { id, status: "failed" as const, error: "confirmation_mismatch" }
          : // The rest of the request is untouched and stays as it was.
            (others.get(id) ?? { id, status: "open" as const })
      );
    }
  }

  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? CONFIRM_BUDGET_MS);
  const outcomes = new Map<string, ProposalOutcome>();
  for (const row of [...own].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (now() > deadline) {
      outcomes.set(row.id, { id: row.id, status: "open" });
      continue;
    }
    // Claimed alone, just before it runs: a timeout can strand at most the
    // row being run, never the rest of the card.
    const [claimed] = await claimActionProposals([row.id], userId);
    if (!claimed) continue; // decided meanwhile (another tab); explained below
    outcomes.set(row.id, await confirmOne(claimed, identity));
  }
  const unclaimed = await explainUnclaimed(ids.filter((id) => !outcomes.has(id)), userId);
  return ids.map((id) => outcomes.get(id) ?? unclaimed.get(id)!);
}

async function confirmOne(row: ActionProposalRecord, identity: Identity): Promise<ProposalOutcome> {
  const decidedBy = identity.userId as string;
  const def = actionById(row.actionId);
  if (!def) {
    await settleActionProposal(row.id, { status: "failed", result: { error: "failed" }, decidedBy });
    return { id: row.id, status: "failed", error: "failed" };
  }
  // A proposal stored before its action left the assistant (owner decision
  // 2026-09-27), or written by anything but proposeAction, commits nothing:
  // every row here came from the assistant, chat or MCP.
  if (!assistantMayPropose(def)) {
    await settleActionProposal(row.id, { status: "failed", result: { error: "not_offered" }, decidedBy });
    return { id: row.id, status: "failed", error: "not_offered" };
  }
  // The card's "before" can be an hour old: re-read it after the gate, and
  // refuse if a field the card shows has changed since (§3.3 step 4).
  let drifted: DriftedField[] = [];
  const stored = row.preview as unknown as ActionPreview;
  const beforeRun = def.preview
    ? async (input: unknown, ctx: ActionContext) => {
        drifted = driftedFields(stored, await def.preview!(input as never, ctx));
        return drifted.length > 0 ? ("conflict" as const) : null;
      }
    : undefined;
  let result;
  try {
    result = await performAction(def, row.input, identity, { surface: row.surface, proposalId: row.id, beforeRun });
  } catch (err) {
    // performAction answers refusals as values; a throw is a bug or the
    // database, and the row must not stay `confirming` forever.
    console.error(`[action-proposals] ${row.actionId} threw at confirm`, err);
    result = { ok: false as const, error: "failed" };
  }
  const link = typeof row.preview.link === "string" ? row.preview.link : undefined;
  if (result.ok) {
    const warning = "warning" in result ? result.warning : undefined;
    await settleActionProposal(row.id, { status: "confirmed", result: warning ? { warning } : {}, decidedBy });
    return { id: row.id, status: "confirmed", ...(warning ? { warning } : {}), ...(link ? { link } : {}) };
  }
  if (result.error === "conflict") {
    const detail = drifted.length > 0 ? { drifted } : {};
    await settleActionProposal(row.id, { status: "conflict", result: { error: "conflict", ...detail }, decidedBy });
    return { id: row.id, status: "conflict", error: "conflict", ...detail };
  }
  await settleActionProposal(row.id, { status: "failed", result: { error: result.error }, decidedBy });
  return { id: row.id, status: "failed", error: result.error };
}

/**
 * Why each of `ids` could not be claimed. Somebody else's proposal answers
 * `not_found`, exactly like an id that names nothing: a person learns nothing
 * about another's proposals by guessing ids.
 */
async function explainUnclaimed(ids: readonly string[], userId: string): Promise<Map<string, ProposalOutcome>> {
  const rows = new Map((await getActionProposals(ids)).map((row) => [row.id, row]));
  const out = new Map<string, ProposalOutcome>();
  for (const id of ids) {
    const row = rows.get(id);
    if (!row || row.createdBy !== userId) out.set(id, { id, status: "not_found" });
    else if (row.expired) out.set(id, { id, status: "expired" });
    else out.set(id, { id, status: "already_decided" });
  }
  return out;
}

export { typedMatches };
