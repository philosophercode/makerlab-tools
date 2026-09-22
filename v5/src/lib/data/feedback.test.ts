// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { feedback, tools } from "../db/schema/index";
import { insertUserRow } from "../../../test/utils/session";
import type { Db } from "../db/types";
import { createFeedback } from "./feedback";

/**
 * Corrections against a real (in-process) Postgres. No env, no network.
 */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(feedback);
  await db.delete(tools);
  const [tool] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", published: true })
    .returning({ id: tools.id });
  toolId = tool.id;
});

async function storedRow(id: string) {
  const [row] = await db.select().from(feedback).where(eq(feedback.id, id));
  return row;
}

describe("createFeedback", () => {
  it("opens the correction as `new` against the tool it names", async () => {
    const { id } = await createFeedback(
      {
        toolId,
        fieldFlagged: "materials",
        issueDescription: "Resin list is missing Rigid 10K.",
        suggestedFix: "Add Rigid 10K.",
        reporterName: "Ada",
      },
      { db }
    );

    expect(await storedRow(id)).toMatchObject({
      toolId,
      fieldFlagged: "materials",
      issueDescription: "Resin list is missing Rigid 10K.",
      suggestedFix: "Add Rigid 10K.",
      reporterName: "Ada",
      status: "new",
    });
  });

  it("leaves the optional columns null rather than empty", async () => {
    const { id } = await createFeedback(
      { toolId, fieldFlagged: "description", issueDescription: "Wrong." },
      { db }
    );

    const row = await storedRow(id);
    expect(row.suggestedFix).toBeNull();
    expect(row.reporterName).toBeNull();
    expect(row.reporterEmail).toBeNull();
    expect(row.reporterUserId).toBeNull();
    expect(row.createdBy).toBeNull();
  });

  it("records the reporter's email and id when a session supplied them", async () => {
    // `created_by` references `user.id` since Phase 4; the reporter is a row.
    await insertUserRow(db, { id: "google-sub-1", email: "ada@cornell.edu" });
    const { id } = await createFeedback(
      {
        toolId,
        fieldFlagged: "location",
        issueDescription: "Lives in the Resin Bench.",
        reporterEmail: "ada@cornell.edu",
        reporterUserId: "google-sub-1",
      },
      { db }
    );

    const row = await storedRow(id);
    expect(row.reporterEmail).toBe("ada@cornell.edu");
    expect(row.reporterUserId).toBe("google-sub-1");
    expect(row.createdBy).toBe("google-sub-1");
  });

  it("stores a tool id that is not uuid-shaped as null rather than casting", async () => {
    // A slug or free text reaching a uuid column answers a cast error, not an
    // empty result — a correction staff match up by hand beats one lost.
    const { id } = await createFeedback(
      { toolId: "form-4", fieldFlagged: null, issueDescription: "Something is off." },
      { db }
    );

    const row = await storedRow(id);
    expect(row.toolId).toBeNull();
    expect(row.issueDescription).toBe("Something is off.");
  });

  it("accepts a correction with no field named", async () => {
    const { id } = await createFeedback(
      { toolId, fieldFlagged: null, issueDescription: "General complaint." },
      { db }
    );

    expect((await storedRow(id)).fieldFlagged).toBeNull();
  });

  it("writes only to feedback — the tool it names is untouched", async () => {
    const before = await db.select().from(tools).where(eq(tools.id, toolId));

    await createFeedback(
      { toolId, fieldFlagged: "name", issueDescription: "Misspelled." },
      { db }
    );

    // The assertion that matters (spec §8): a flag is inert.
    const after = await db.select().from(tools).where(eq(tools.id, toolId));
    expect(after).toEqual(before);
  });
});
