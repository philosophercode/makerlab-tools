// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission, to prove each action asks for its own (`insights.view`). */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions ? override.permissions.has(permission) : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { feedback, session, tools, usageGaps } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { gapKey } from "../../../lib/usage/gap-key";
import { recordUsage } from "../../../lib/usage/record";
import { signInAsNew } from "../../../../test/utils/session";
import { dismissUnanswered, fileUnansweredAsCorrection } from "./actions";

/**
 * `/admin/insights`' two endpoints (usage insight spec §7): called directly,
 * as a server action can be, so the gate in `performAction` is all that
 * stands in front of each write.
 */

let db: Db;
let gapId: string;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-insights-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  db = await getDb();
  await db.delete(usageGaps);
  await db.delete(feedback);
  await db.delete(session);
  const [tool] = await db.insert(tools).values({ slug: `insights-test-${Date.now()}`, name: "Insights Test Saw", published: true }).returning({ id: tools.id });
  toolId = tool.id;
  const [gap] = await db.insert(usageGaps).values({ key: gapKey("Can it cut glass?", toolId), kind: "no_manual_passage", toolId, question: "Can it cut glass?", occurrences: 2 }).returning({ id: usageGaps.id });
  gapId = gap.id;
});

afterEach(async () => {
  override.permissions = null;
  await db.delete(usageGaps);
  await db.delete(tools).where(eq(tools.id, toolId));
  resetAuthForTests();
  resetDbForTests();
});

async function storedGap() {
  const [row] = await db.select().from(usageGaps).where(eq(usageGaps.id, gapId));
  return row;
}

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const signedIn = await signInAsNew({ email, role });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

it("refuses an anonymous caller and a student, changing nothing", async () => {
  setMockHeaders();
  expect(await dismissUnanswered({ gapId })).toEqual({ ok: false, error: "not_signed_in" });
  await signIn("user", "casey@cornell.edu");
  expect(await fileUnansweredAsCorrection({ gapId })).toEqual({ ok: false, error: "not_permitted" });
  expect((await storedGap()).status).toBe("open");
  expect(await db.select().from(feedback)).toHaveLength(0);
});

it("asks for insights.view, not an adjacent permission", async () => {
  await signIn("admin", "niti@cornell.edu");
  override.permissions = new Set(["feedback.manage", "tools.edit"]);
  expect(await fileUnansweredAsCorrection({ gapId })).toEqual({ ok: false, error: "not_permitted" });
  override.permissions = new Set(["insights.view"]);
  expect(await dismissUnanswered({ gapId })).toEqual({ ok: true });
});

it("dismisses a gap, recording the staff member who did it; three more askings reopen it", async () => {
  const admin = await signIn("admin", "niti@cornell.edu");
  expect(await dismissUnanswered({ gapId })).toEqual({ ok: true });
  const row = await storedGap();
  expect(row).toMatchObject({ status: "dismissed", decidedBy: admin.user.id, dismissedAtOccurrences: 2 });
  const again = { kind: "no_manual_passage" as const, question: "Can it cut glass?", toolId, audience: "anonymous" as const, surface: "chat" as const };
  for (let i = 0; i < 2; i += 1) await recordUsage([], [again], { db });
  expect((await storedGap()).status).toBe("dismissed");
  await recordUsage([], [again], { db });
  expect(await storedGap()).toMatchObject({ status: "open", occurrences: 5 });
});

it("files a gap as a new correction on the tool, with no reporter, and marks it filed", async () => {
  const admin = await signIn("super_admin", "luis@cornell.edu");
  expect(await fileUnansweredAsCorrection({ gapId })).toEqual({ ok: true });
  const row = await storedGap();
  expect(row.status).toBe("filed");
  const [correction] = await db.select().from(feedback).where(eq(feedback.id, row.feedbackId!));
  expect(correction).toMatchObject({ toolId, status: "new", reporterName: null, reporterEmail: null, reporterUserId: null, createdBy: admin.user.id });
  expect(correction.issueDescription).toContain("Can it cut glass?");
  // Filing twice files once.
  expect(await fileUnansweredAsCorrection({ gapId })).toEqual({ ok: true });
  expect(await db.select().from(feedback)).toHaveLength(1);
});

it("answers not_found for a gap that is gone or an id that is not one", async () => {
  await signIn("admin", "niti@cornell.edu");
  expect(await dismissUnanswered({ gapId: "not-a-uuid" })).toEqual({ ok: false, error: "not_found" });
  await db.delete(usageGaps);
  expect(await fileUnansweredAsCorrection({ gapId })).toEqual({ ok: false, error: "not_found" });
});
