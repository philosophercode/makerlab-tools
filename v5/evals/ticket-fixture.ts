import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { DEMO_ACCOUNTS } from "@/lib/db/demo-seed";
import { maintenanceLogs, tools } from "@/lib/db/schema/index";

/**
 * An open Form 4 ticket for the staff maintenance evals
 * (`cases/staff-maintenance.yaml`; MCP access spec amendment 2026-09-25).
 *
 * The demo seed's only open ticket is the Trotec's, so "what maintenance is
 * open on the Form 4?" would have nothing to find. `seedEvalTickets()` adds one
 * to the eval's own PGlite database — `list_open_tickets` then reads it for
 * real, as `search_manual` reads the fixture manual, while `update_ticket` stays
 * a recorded no-op like every write.
 */

export const EVAL_TICKET_TITLE = "Resin tank film clouded";

/** Store the fixture ticket on the demo Form 4. Idempotent per process. */
export async function seedEvalTickets(): Promise<void> {
  const db = await getDb();
  const [form4] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  if (!form4) throw new Error("the demo seed has no form-4 tool");
  const existing = await db.select({ id: maintenanceLogs.id }).from(maintenanceLogs).where(eq(maintenanceLogs.title, EVAL_TICKET_TITLE));
  if (existing.length > 0) return;

  const student = DEMO_ACCOUNTS.user;
  await db.insert(maintenanceLogs).values({
    title: EVAL_TICKET_TITLE,
    description: "Prints are failing to release and the tank film looks cloudy in the middle.",
    type: "issue_report",
    priority: "medium",
    status: "open",
    toolId: form4.id,
    toolName: "Form 4",
    reportedByName: student.name,
    reportedByEmail: student.email,
    reportedByUserId: student.id,
    dateReported: "2026-09-20",
    createdBy: student.id,
    updatedBy: student.id,
  });
}
