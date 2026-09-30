// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { decideActionProposals, proposeAction } from "../../../lib/actions/proposals";
import { actionById } from "../../../lib/actions/registry";
import { resetAuthForTests } from "../../../lib/auth/config";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { maintenanceLogs, session, tools, units, user } from "../../../lib/db/schema/index";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import { signInAsNew } from "../../../../test/utils/session";
import { logCompletedMaintenance } from "./actions";

/**
 * **Log completed maintenance** (assistant–GUI parity spec §11 answer 5): the
 * page's form and the assistant's card commit the same `tickets.log_completed`
 * — a resolved ticket with the signed-in person as reporter and assignee.
 */

let toolId: string;
let unitId: string;
let otherUnitId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "log-completed-test-secret");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  resetAuthForTests();
  vi.mocked(requestMirrorPush).mockClear();
  vi.mocked(revalidatePath).mockClear();
  const db = await getDb();
  await db.delete(maintenanceLogs);
  await db.delete(session);
  await db.delete(user);
  const [wen, other] = await db
    .insert(tools)
    .values([
      { slug: "wen-bandsaw", name: "WEN Bandsaw", published: true },
      { slug: "other-saw", name: "Other Saw", published: true },
    ])
    .returning({ id: tools.id });
  toolId = wen.id;
  const [unit, foreign] = await db
    .insert(units)
    .values([
      { toolId: wen.id, unitLabel: "WEN #1" },
      { toolId: other.id, unitLabel: "Other #1" },
    ])
    .returning({ id: units.id });
  unitId = unit.id;
  otherUnitId = foreign.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function asStaff() {
  const signedIn = await signInAsNew({ email: "sam@cornell.edu", role: "admin", name: "Sam Maker" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

describe("logCompletedMaintenance (the page's form)", () => {
  it("records a resolved ticket with the person as reporter and assignee", async () => {
    const staff = await asStaff();
    const result = await logCompletedMaintenance({
      tool: toolId,
      unitId,
      title: "  Replaced the   drive belt ",
      resolution: "New belt, tension set.",
      type: "repair",
    });
    expect(result).toMatchObject({ ok: true });
    const db = await getDb();
    const [row] = await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.toolId, toolId));
    expect(row).toMatchObject({
      title: "Replaced the drive belt",
      status: "resolved",
      type: "repair",
      resolution: "New belt, tension set.",
      toolName: "WEN Bandsaw",
      unitId,
      unitLabel: "WEN #1",
      reportedByUserId: staff.user.id,
      reportedByName: "Sam Maker",
      reportedByEmail: null,
      assignedToUserId: staff.user.id,
    });
    expect(row.dateResolved).toBe(row.dateReported);
    expect(requestMirrorPush).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/maintenance");
  });

  it("refuses a unit of another tool, an unknown tool, a problem report and empty text — writing nothing", async () => {
    await asStaff();
    const base = { tool: toolId, unitId: null, title: "Belt", resolution: "Replaced", type: "repair" };
    expect(await logCompletedMaintenance({ ...base, unitId: otherUnitId })).toEqual({ ok: false, error: "invalid_field" });
    expect(await logCompletedMaintenance({ ...base, tool: "no-such-tool" })).toEqual({ ok: false, error: "not_found" });
    expect(await logCompletedMaintenance({ ...base, type: "issue_report" })).toEqual({ ok: false, error: "invalid_field" });
    expect(await logCompletedMaintenance({ ...base, resolution: "   " })).toEqual({ ok: false, error: "invalid_field" });
    const db = await getDb();
    expect(await db.select().from(maintenanceLogs)).toEqual([]);
  });

  it("is refused to a student", async () => {
    const student = await signInAsNew({ email: "stu@cornell.edu", role: "user" });
    setMockHeaders({ cookie: student.cookie });
    expect(await logCompletedMaintenance({ tool: toolId, unitId: null, title: "x", resolution: "y", type: "repair" })).toEqual({
      ok: false,
      error: "not_permitted",
    });
  });
});

describe("log_completed_maintenance (the assistant's card)", () => {
  it("proposes from the tool's slug and commits the same row on Confirm", async () => {
    await asStaff();
    const identity = await resolveIdentityFromHeaders();
    const proposed = await proposeAction(
      actionById("tickets.log_completed")!,
      { tool: "wen-bandsaw", title: "Replaced the belt", what_was_done: "Replaced the belt." },
      { identity, surface: "assistant", chatId: null }
    );
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals[0].preview).toMatchObject({
      summary: { key: "tickets_log_completed", values: { tool: "WEN Bandsaw" } },
      subjectName: "WEN Bandsaw",
    });
    const db = await getDb();
    expect(await db.select().from(maintenanceLogs)).toEqual([]);

    expect(await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, identity)).toEqual([
      expect.objectContaining({ status: "confirmed" }),
    ]);
    const [row] = await db.select().from(maintenanceLogs);
    expect(row).toMatchObject({ toolId, status: "resolved", type: "repair", title: "Replaced the belt" });
  });
});
