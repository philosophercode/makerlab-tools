// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

const auditFailure = vi.hoisted(() => ({ on: false }));
vi.mock("../data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/audit")>();
  return {
    ...actual,
    recordAuditEvent: (...args: Parameters<typeof actual.recordAuditEvent>) =>
      auditFailure.on ? Promise.reject(new Error("audit down")) : actual.recordAuditEvent(...args),
  };
});

import { revalidatePath } from "next/cache";
import { resetAuthForTests } from "../auth/config";
import { listAuditEvents } from "../data/audit";
import { findUserById } from "../data/users";
import { getDb, resetDbForTests } from "../db/client";
import { auditEvents } from "../db/schema/index";
import { seedUser, signInAsNew } from "../../../test/utils/session";
import { updateOwnName } from "./name-actions";

/**
 * **Name** on `/account`: anybody signed in renames themselves — and only
 * themselves — with the same rule and the same audit event as the People page.
 */

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "name-actions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  auditFailure.on = false;
  vi.mocked(revalidatePath).mockClear();
  setMockHeaders();
  const db = await getDb();
  await db.delete(auditEvents);
});

afterAll(() => resetDbForTests());

let n = 0;
async function signIn(name = "Casey") {
  n += 1;
  const signedIn = await signInAsNew({ email: `self-${n}@cornell.edu`, role: "user", name });
  setMockHeaders({ cookie: signedIn.cookie, "x-forwarded-for": `10.1.0.${n % 250}` });
  return signedIn;
}

describe("updateOwnName", () => {
  it("refuses somebody who is not signed in", async () => {
    expect(await updateOwnName({ name: "Anybody" })).toEqual({ ok: false, error: "not_signed_in" });
    expect(await listAuditEvents()).toEqual([]);
  });

  it("renames the caller, trimmed, and records user.name_changed with the caller as actor", async () => {
    const me = await signIn("Casey");

    expect(await updateOwnName({ name: "  Casey   Rivera " })).toEqual({ ok: true, name: "Casey Rivera" });
    expect((await findUserById(me.user.id))?.name).toBe("Casey Rivera");

    const [event] = await listAuditEvents();
    expect(event).toMatchObject({
      actorUserId: me.user.id,
      action: "user.name_changed",
      subjectType: "user",
      subjectId: me.user.id,
      detail: { from: "Casey", to: "Casey Rivera" },
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/account");
  });

  it("only ever renames the caller, whatever else the wire carries", async () => {
    const other = await seedUser({ email: "other@cornell.edu", role: "user", name: "Other" });
    const me = await signIn("Casey");

    const forged = { name: "Hijacked", userId: other.id } as unknown as { name: string };
    expect(await updateOwnName(forged)).toEqual({ ok: true, name: "Hijacked" });
    expect((await findUserById(other.id))?.name).toBe("Other");
    expect((await findUserById(me.user.id))?.name).toBe("Hijacked");
  });

  it("refuses a blank or over-long name and stores nothing", async () => {
    const me = await signIn("Casey");

    for (const name of ["", "  ", "x".repeat(81), 7 as unknown as string]) {
      expect(await updateOwnName({ name })).toEqual({ ok: false, error: "invalid_name" });
    }
    expect((await findUserById(me.user.id))?.name).toBe("Casey");
    expect(await listAuditEvents()).toEqual([]);
  });

  it("treats their current name as a no-op with no event", async () => {
    await signIn("Casey");
    expect(await updateOwnName({ name: "Casey" })).toEqual({ ok: true, name: "Casey" });
    expect(await listAuditEvents()).toEqual([]);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("is a success with the gap named when the audit write fails after the rename", async () => {
    const me = await signIn("Casey");
    auditFailure.on = true;

    expect(await updateOwnName({ name: "Casey R." })).toEqual({
      ok: true,
      name: "Casey R.",
      warning: "audit_unavailable",
    });
    expect((await findUserById(me.user.id))?.name).toBe("Casey R.");
  });
});
