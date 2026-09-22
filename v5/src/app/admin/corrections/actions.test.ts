// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/**
 * Withhold or grant one permission, to prove the action asks for its own.
 *
 * `admin` holds `tools.edit` and `feedback.manage` together, so the only way to
 * test that this endpoint checks the second rather than the first is to take
 * the declaration out of the picture for one test — and this is the surface
 * where it matters most, because fixing the catalogue and triaging the report
 * about it are so obviously adjacent. Null means the real `can()`.
 */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

/** A database that refuses the write itself, rather than declining it. */
const writes = vi.hoisted(() => ({ failing: false }));

vi.mock("../../../lib/data/feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/data/feedback")>();
  return {
    ...actual,
    updateFeedbackStatus: async (...args: Parameters<typeof actual.updateFeedbackStatus>) => {
      if (writes.failing) throw new Error("connection terminated unexpectedly");
      return actual.updateFeedbackStatus(...args);
    },
  };
});

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { feedback, session, tools, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { setCorrectionStatus } from "./actions";

/**
 * `/admin/corrections`' one endpoint (spec §5.6, §8).
 *
 * Called directly, with no page: a server action is a POST endpoint with a
 * generated name, so the gate is the only thing in front of the write. The
 * write is covered in `src/lib/data/feedback.test.ts`; this is about who may
 * call it, and that a refusal is a value rather than an exception.
 */

const AUTH_SECRET = "admin-corrections-test-secret";

let db: Db;
let correctionId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  writes.failing = false;

  db = await getDb();
  await db.delete(feedback);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  const [tool] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4" })
    .returning({ id: tools.id });
  const [correction] = await db
    .insert(feedback)
    .values({
      toolId: tool.id,
      fieldFlagged: "materials",
      issueDescription: "The resin list is missing Rigid 10K.",
      status: "new",
    })
    .returning({ id: feedback.id });
  correctionId = correction.id;
});

afterEach(() => {
  override.permissions = null;
  writes.failing = false;
  resetAuthForTests();
  resetDbForTests();
});

async function storedCorrection() {
  const [row] = await db.select().from(feedback).where(eq(feedback.id, correctionId));
  return row;
}

async function asSuperMaker(email = "niti@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

it("refuses an anonymous caller, and changes nothing", async () => {
  setMockHeaders();

  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "fixed" })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect((await storedCorrection()).status).toBe("new");
});

it("refuses a student, who may report a correction but not close one", async () => {
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "dismissed" })).toEqual({
    ok: false,
    error: "not_permitted",
  });
  expect((await storedCorrection()).status).toBe("new");
});

it("refuses a caller who holds tools.edit but not feedback.manage", async () => {
  await asSuperMaker();

  override.permissions = new Set(["tools.edit", "tools.publish"]);
  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "fixed" })).toEqual({
    ok: false,
    error: "not_permitted",
  });
  expect((await storedCorrection()).status).toBe("new");

  override.permissions = new Set(["feedback.manage"]);
  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "fixed" })).toEqual({
    ok: true,
  });
});

it("marks a correction fixed, stamps who did it and refreshes the queue", async () => {
  const signedIn = await asSuperMaker();
  const { revalidatePath } = await import("next/cache");

  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "fixed" })).toEqual({
    ok: true,
  });

  const row = await storedCorrection();
  expect(row.status).toBe("fixed");
  expect(row.updatedBy).toBe(signedIn.user.id);
  // And nothing else about the report is touched: triaging is not editing.
  expect(row.issueDescription).toBe("The resin list is missing Rigid 10K.");
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/corrections");
});

it("lets a dismissal be undone, because it was a judgement", async () => {
  await asSuperMaker();
  await setCorrectionStatus({ feedbackId: correctionId, status: "dismissed" });

  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "new" })).toEqual({
    ok: true,
  });
  expect((await storedCorrection()).status).toBe("new");
});

it("passes the write layer's refusals through as codes, not exceptions", async () => {
  await asSuperMaker();

  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "resolved" })).toEqual({
    ok: false,
    error: "invalid_field",
  });
  expect(await setCorrectionStatus({ feedbackId: crypto.randomUUID(), status: "fixed" })).toEqual({
    ok: false,
    error: "not_found",
  });
  expect((await storedCorrection()).status).toBe("new");
});

it("answers `failed` rather than throwing when the database is unreachable", async () => {
  await asSuperMaker();
  writes.failing = true;

  // The data layer throws because its callers have to tell "we declined" from
  // "we do not know". A server action may not: a throw reaches the browser as a
  // digest and an error boundary rather than as a sentence beside the control.
  expect(await setCorrectionStatus({ feedbackId: correctionId, status: "fixed" })).toEqual({
    ok: false,
    error: "failed",
  });
});
