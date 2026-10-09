import type { MaintenanceActionResult, TicketPatch } from "../../app/admin/maintenance/action-result";

/**
 * The open issues a Shift checklist task can resolve (recurring maintenance
 * spec, amendment 2026-10-07): tickets still open or in progress on the
 * machine the task is about. A SuperMaker cleaning the laser's lens who finds
 * the "lens is smudged" report already fixed marks it resolved from the same
 * row, without a trip to the ticket queue.
 *
 * Directive-free and pure, so the overview, the checklist page and the tests
 * share one rule.
 */

/** An open ticket, as the checklist needs it. */
export interface ChecklistIssue {
  id: string;
  title: string;
  toolId: string | null;
  unitId: string | null;
  /** One of `MAINTENANCE_PRIORITY`, or null. */
  priority: string | null;
}

/** The ticket action the checklist calls: `updateTicket` on `/admin/maintenance`. */
export type ResolveIssueAction = (input: { logId: string; patch: TicketPatch }) => Promise<MaintenanceActionResult>;

const OPEN = new Set(["open", "in_progress"]);

/** Open or in-progress tickets only, reduced to what the checklist shows. */
export function openIssues(
  tickets: readonly { id: string; title: string; status: string; toolId: string | null; unitId: string | null; priority: string | null; demo?: boolean }[]
): ChecklistIssue[] {
  return tickets
    // A demo pass's ticket is not the machine's issue (demo pass spec 2026-10-07 §5.4).
    .filter((ticket) => OPEN.has(ticket.status) && !ticket.demo)
    .map(({ id, title, toolId, unitId, priority }) => ({ id, title, toolId, unitId, priority }));
}

/**
 * The issues on the task's machine. A task on one unit matches that unit's
 * tickets and the tool's tickets that name no unit; a task on the whole tool
 * matches every ticket on the tool; general lab upkeep (no tool) matches none.
 */
export function issuesForTask(task: { toolId: string | null; unitId: string | null }, issues: readonly ChecklistIssue[]): ChecklistIssue[] {
  const { toolId, unitId } = task;
  if (!toolId) return [];
  if (!unitId) return issues.filter((issue) => issue.toolId === toolId);
  return issues.filter((issue) => issue.unitId === unitId || (issue.unitId === null && issue.toolId === toolId));
}
