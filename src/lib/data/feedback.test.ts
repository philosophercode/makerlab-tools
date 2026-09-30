// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { feedback, tools } from "../db/schema/index";
import { insertUserRow } from "../../../test/utils/session";
import type { Db } from "../db/types";
import { createFeedback, listFeedbackQueue, updateFeedbackStatus } from "./feedback";

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

describe("listFeedbackQueue", () => {
  async function fileCorrection(values: Partial<typeof feedback.$inferInsert> = {}) {
    await db.insert(feedback).values({
      toolId,
      issueDescription: "Something is wrong.",
      ...values,
    });
  }

  it("puts the untriaged ones first, in the order the vocabulary is declared", async () => {
    await fileCorrection({ issueDescription: "Dismissed", status: "dismissed" });
    await fileCorrection({ issueDescription: "Fixed", status: "fixed" });
    await fileCorrection({ issueDescription: "New", status: "new" });
    await fileCorrection({ issueDescription: "Reviewed", status: "reviewed" });

    const queue = await listFeedbackQueue({ db });

    expect(queue.map((entry) => entry.issueDescription)).toEqual([
      "New",
      "Reviewed",
      "Fixed",
      "Dismissed",
    ]);
  });

  it("carries the tool's slug, so an accepted correction is one click from the field", async () => {
    await fileCorrection({ fieldFlagged: "materials", suggestedFix: "Add Rigid 10K." });

    const [entry] = await listFeedbackQueue({ db });

    expect(entry.toolSlug).toBe("form-4");
    expect(entry.toolName).toBe("Form 4");
    // Stored, not display text: the page translates, and the value posts back.
    expect(entry.fieldFlagged).toBe("materials");
    expect(entry.suggestedFix).toBe("Add Rigid 10K.");
  });

  it("keeps a correction whose tool never resolved, and links nowhere rather than wrongly", async () => {
    await fileCorrection({ toolId: null, issueDescription: "The laser near the door" });

    const [entry] = await listFeedbackQueue({ db });

    expect(entry.toolId).toBeNull();
    expect(entry.toolSlug).toBeNull();
    expect(entry.toolName).toBe("");
    expect(entry.issueDescription).toBe("The laser near the door");
  });

  it("selects the reporter's address for the one page that may see it", async () => {
    await fileCorrection({ reporterName: "Ada", reporterEmail: "ada@cornell.edu" });

    const [entry] = await listFeedbackQueue({ db });

    expect(entry.reporterName).toBe("Ada");
    expect(entry.reporterEmail).toBe("ada@cornell.edu");
  });

  it("is bounded", async () => {
    await fileCorrection();
    await fileCorrection();

    expect(await listFeedbackQueue({ db, limit: 1 })).toHaveLength(1);
  });
});

describe("updateFeedbackStatus", () => {
  it("marks a correction fixed and records who did it", async () => {
    const staff = await insertUserRow(db, { email: "niti@cornell.edu", role: "admin" });
    const { id } = await createFeedback(
      { toolId, fieldFlagged: "materials", issueDescription: "Missing Rigid 10K." },
      { db }
    );

    expect(await updateFeedbackStatus(id, "fixed", { db, actorUserId: staff.id })).toEqual({
      ok: true,
    });

    const row = await storedRow(id);
    expect(row.status).toBe("fixed");
    expect(row.updatedBy).toBe(staff.id);
    // The report itself is untouched — the queue triages, it does not rewrite
    // what somebody said.
    expect(row.issueDescription).toBe("Missing Rigid 10K.");
  });

  it("refuses a status outside the vocabulary and changes nothing", async () => {
    const { id } = await createFeedback({ toolId, fieldFlagged: null, issueDescription: "?" }, { db });

    expect(await updateFeedbackStatus(id, "resolved", { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect((await storedRow(id)).status).toBe("new");
  });

  it("answers not_found for an unknown id and for anything that is not a uuid", async () => {
    expect(await updateFeedbackStatus(crypto.randomUUID(), "fixed", { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await updateFeedbackStatus("form-4", "fixed", { db })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
