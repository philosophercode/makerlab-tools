/**
 * Confirming several proposals for one tool in one step (assistant–GUI parity
 * spec, amendment 2026-10-07 "manual triage").
 *
 * Every tool-editor proposal stores the tool's revision as it was when the
 * assistant proposed it. A confirmed write moves that revision, so the next
 * proposal for the same tool used to answer `conflict` even when the only
 * change since was the one just confirmed.
 *
 * **The rule.** Inside one confirm request, rows run in the order they were
 * proposed. When a row for tool T confirms, its write answered the tool's new
 * revision from the same statement that checked the old one (`touchTool` in
 * `withTouchedTool`). So we know, for certain, that T went from revision A to
 * revision B through our write alone. The next row for T that stored A runs
 * with B instead. Its own write checks B in the database, so it lands only
 * if nothing else wrote to T since our last write. Someone else's edit in
 * between still answers `conflict`, exactly as before.
 *
 * - Only {@link CHAINED_ACTIONS} take part: actions whose write checks and
 *   answers the tool's revision in one statement. Anything else runs with the
 *   revision it stored.
 * - A row that stored some other revision is never moved.
 * - Any row for T that does not confirm (refused, failed, conflict) stops the
 *   chain for T for the rest of the request: the rows after it run with what
 *   they stored, and so come back as `conflict` for the person to look at.
 * - The chain lives for one request. Nothing is remembered between clicks.
 *
 * Every other rule still runs per row in `performAction`: the permission, the
 * action's own `check`, and the field-by-field drift check (`staleness.ts`).
 * So a proposal whose shown "before" was changed by an earlier row in the
 * same step still answers `conflict`.
 *
 * Pure: `decideActionProposals` owns one per request.
 */

/** The actions whose write checks and returns the tool's revision atomically (`withTouchedTool`). */
export const CHAINED_ACTIONS: ReadonlySet<string> = new Set(["resources.add", "resources.edit"]);

export interface ToolRevisionRef {
  toolId: string;
  expectedRevision: string;
}

/** The tool and revision a stored input names, or null when it names none (or an empty revision). */
export function toolRevisionOf(input: unknown): ToolRevisionRef | null {
  if (!input || typeof input !== "object") return null;
  const { toolId, expectedRevision } = input as { toolId?: unknown; expectedRevision?: unknown };
  if (typeof toolId !== "string" || !toolId) return null;
  if (typeof expectedRevision !== "string" || !expectedRevision) return null;
  return { toolId, expectedRevision };
}

/** What happened to a row that ran: confirmed with the tool's new revision, or not confirmed. */
export type ChainOutcome = { confirmed: true; revision?: string } | { confirmed: false };

interface Link {
  /** The revision the first confirmed row of this request started from. */
  base: string;
  /** The revision our last confirmed write left the tool at. */
  current: string;
}

export class RevisionChain {
  private readonly links = new Map<string, Link>();
  private readonly stopped = new Set<string>();

  constructor(private readonly actions: ReadonlySet<string> = CHAINED_ACTIONS) {}

  /**
   * The input to run for a row: the stored one, or the stored one with its
   * revision moved to what our own earlier writes in this request left.
   */
  inputFor(actionId: string, input: unknown): { input: unknown; chained: boolean } {
    if (!this.actions.has(actionId)) return { input, chained: false };
    const ref = toolRevisionOf(input);
    if (!ref || this.stopped.has(ref.toolId)) return { input, chained: false };
    const link = this.links.get(ref.toolId);
    if (!link || ref.expectedRevision !== link.base || link.base === link.current) return { input, chained: false };
    return { input: { ...(input as object), expectedRevision: link.current }, chained: true };
  }

  /** Record how a row ran, with the input it actually ran with. */
  record(actionId: string, ranInput: unknown, outcome: ChainOutcome): void {
    const ref = toolRevisionOf(ranInput);
    if (!ref || this.stopped.has(ref.toolId)) return;
    const stop = () => {
      this.links.delete(ref.toolId);
      this.stopped.add(ref.toolId);
    };
    // A row outside the chained actions moved the tool in a way we cannot
    // vouch for: whatever it did, later rows keep their stored revision.
    if (!this.actions.has(actionId)) {
      if (outcome.confirmed) stop();
      return;
    }
    if (!outcome.confirmed || !outcome.revision) {
      stop();
      return;
    }
    const link = this.links.get(ref.toolId);
    if (!link) {
      this.links.set(ref.toolId, { base: ref.expectedRevision, current: outcome.revision });
    } else if (ref.expectedRevision === link.current) {
      link.current = outcome.revision;
    } else {
      // It confirmed from a revision our last write did not leave: something
      // else wrote in between. Never build on that.
      stop();
    }
  }
}
