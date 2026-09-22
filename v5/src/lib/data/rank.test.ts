// @vitest-environment node
import { desc } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { feedback, tools } from "../db/schema/index";
import { FEEDBACK_STATUS } from "../db/schema/vocabulary";
import type { Db } from "../db/types";
import { rankByVocabulary } from "./rank";

/**
 * Ordering by a declared vocabulary, against a real (in-process) Postgres.
 *
 * Both queues depend on this and neither would fail loudly if it were wrong —
 * a queue in the wrong order is still a queue, and the person using it would
 * simply find it unhelpful. So it is asserted here directly as well as through
 * `listMaintenanceQueue` and `listFeedbackQueue`.
 */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
  const [tool] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4" })
    .returning({ id: tools.id });
  toolId = tool.id;
});

beforeEach(async () => {
  await db.delete(feedback);
});

async function statusesInRankOrder(): Promise<string[]> {
  const rows = await db
    .select({ status: feedback.status })
    .from(feedback)
    .orderBy(rankByVocabulary(feedback.status, FEEDBACK_STATUS), desc(feedback.createdAt));
  return rows.map((row) => row.status);
}

it("orders by the position in the list, not alphabetically", async () => {
  // Alphabetically this is dismissed, fixed, new, reviewed — which would put
  // the work nobody has looked at yet third.
  for (const status of ["reviewed", "dismissed", "new", "fixed"]) {
    await db.insert(feedback).values({ toolId, issueDescription: status, status });
  }

  expect(await statusesInRankOrder()).toEqual(["new", "reviewed", "fixed", "dismissed"]);
});

it("ranks a value the list does not name after every value it does", async () => {
  for (const status of ["dismissed", "fixed", "new"]) {
    await db.insert(feedback).values({ toolId, issueDescription: status, status });
  }

  // Ranked against a list that names only two of the three. `feedback_status_check`
  // makes a genuinely unknown value impossible to insert, which is the point of
  // the constraint — so the missing value is arranged by shortening the list
  // instead. What is under test is the `else` branch: an unrecognised value is
  // not a reason to put a row at the top of somebody's queue.
  const rows = await db
    .select({ status: feedback.status })
    .from(feedback)
    .orderBy(rankByVocabulary(feedback.status, ["fixed", "new"]));

  expect(rows.map((row) => row.status)).toEqual(["fixed", "new", "dismissed"]);
});
