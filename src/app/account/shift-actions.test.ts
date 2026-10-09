// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission, to prove the action asks for its own (`shifts.set`). */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions ? override.permissions.has(permission) : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { SHIFTS_SET } from "../../lib/actions/shifts";
import { resetAuthForTests } from "../../lib/auth/config";
import { getOwnShiftEnd } from "../../lib/data/staff-shifts";
import { getDb, resetDbForTests } from "../../lib/db/client";
import { session, staffShifts, user } from "../../lib/db/schema/index";
import type { Db } from "../../lib/db/types";
import { loadOnShiftNames } from "../../lib/on-shift/read";
import { signInAsNew } from "../../../test/utils/session";
import { setMyShift } from "./shift-actions";

/**
 * `setMyShift` (on-shift spec 2026-10-07): called directly, as a server action
 * can be, so `performAction`'s gate (signed in, then `shifts.set`) and the
 * definition's schema are all that stand in front of the write. Then what
 * students see: `loadOnShiftNames`, the read every public surface and the
 * chat use, including a shift ending by itself.
 *
 * The clock is fixed at 10:00 in New York on 7 October (only `Date` is
 * faked, so the in-process database keeps its own timers).
 */

let db: Db;
const TEN_AM_NY = new Date("2026-10-07T14:00:00Z");

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEN_AM_NY);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "on-shift-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  resetAuthForTests();
  override.permissions = null;
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(revalidatePath).mockClear();
  db = await getDb();
  await db.delete(staffShifts);
  await db.delete(session);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
});

async function signIn(role: "user" | "admin" | "super_admin", email: string, name = "Alex Morgan") {
  const signedIn = await signInAsNew({ email, role, name });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

describe("who may mark themselves on shift", () => {
  it("refuses an anonymous caller and a student, storing nothing", async () => {
    setMockHeaders();
    expect(await setMyShift({ onShift: true, until: "18:00" })).toEqual({ ok: false, error: "not_signed_in" });
    await signIn("user", "casey@cornell.edu", "Casey Student");
    expect(await setMyShift({ onShift: true, until: "18:00" })).toEqual({ ok: false, error: "not_permitted" });
    expect(await db.select().from(staffShifts)).toEqual([]);
  });

  it("asks for shifts.set, the permission SuperMakers and directors hold", async () => {
    await signIn("admin", "alex@cornell.edu");
    override.permissions = new Set(["maintenance.manage", "tools.edit"]);
    expect(await setMyShift({ onShift: true, until: "18:00" })).toEqual({ ok: false, error: "not_permitted" });
    override.permissions = new Set(["shifts.set"]);
    expect(await setMyShift({ onShift: true, until: "18:00" })).toMatchObject({ ok: true });
  });

  it("lets a director mark themselves too", async () => {
    await signIn("super_admin", "niti@cornell.edu", "Niti Parikh");
    expect(await setMyShift({ onShift: true, until: "17:00" })).toEqual({ ok: true, endsAt: "2026-10-07T21:00:00.000Z" });
    expect(await loadOnShiftNames()).toEqual(["Niti P."]);
  });
});

describe("marking yourself on shift", () => {
  it("stores today's time in lab time, clears the roster's cache and refreshes both pages", async () => {
    const alex = await signIn("admin", "alex@cornell.edu");
    expect(await setMyShift({ onShift: true, until: "18:00" })).toEqual({ ok: true, endsAt: "2026-10-07T22:00:00.000Z" });

    expect(await getOwnShiftEnd(alex.user.id)).toBe("2026-10-07T22:00:00.000Z");
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("on-shift", expect.anything());
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/account");
    // What students see: first name and last initial, nothing more.
    expect(await loadOnShiftNames()).toEqual(["Alex M."]);
  });

  it("changes the end time by replacing the shift", async () => {
    const alex = await signIn("admin", "alex@cornell.edu");
    await setMyShift({ onShift: true, until: "18:00" });
    expect(await setMyShift({ onShift: true, until: "12:30" })).toEqual({ ok: true, endsAt: "2026-10-07T16:30:00.000Z" });
    const rows = await db.select().from(staffShifts).where(eq(staffShifts.userId, alex.user.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses a time that has already passed today, storing nothing", async () => {
    await signIn("admin", "alex@cornell.edu");
    expect(await setMyShift({ onShift: true, until: "09:00" })).toEqual({ ok: false, error: "shift_time_passed" });
    expect(await setMyShift({ onShift: true, until: "10:00" })).toEqual({ ok: false, error: "shift_time_passed" });
    expect(await db.select().from(staffShifts)).toEqual([]);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it.each([
    ["a time that is not a time", { onShift: true, until: "6pm" }],
    ["no time at all", { onShift: true }],
    ["somebody else's id", { onShift: true, until: "18:00", userId: "someone-else" }],
    ["no on/off at all", {}],
  ])("refuses %s with invalid_shift_time, storing nothing", async (_name, input) => {
    await signIn("admin", "alex@cornell.edu");
    expect(await setMyShift(input as never)).toEqual({ ok: false, error: "invalid_shift_time" });
    expect(await db.select().from(staffShifts)).toEqual([]);
  });
});

describe("ending a shift", () => {
  it("ends it now: the row goes, and students see nobody", async () => {
    await signIn("admin", "alex@cornell.edu");
    await setMyShift({ onShift: true, until: "18:00" });
    vi.mocked(revalidateTag).mockClear();

    expect(await setMyShift({ onShift: false })).toEqual({ ok: true, endsAt: null });
    expect(await db.select().from(staffShifts)).toEqual([]);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("on-shift", expect.anything());
    expect(await loadOnShiftNames()).toEqual([]);
  });

  it("treats ending a shift you are not on as no change: nothing refreshed", async () => {
    await signIn("admin", "alex@cornell.edu");
    expect(await setMyShift({ onShift: false })).toEqual({ ok: true, endsAt: null });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("ends by itself at the time picked, with no write and no job", async () => {
    const alex = await signIn("admin", "alex@cornell.edu");
    await setMyShift({ onShift: true, until: "11:00" });
    expect(await loadOnShiftNames()).toEqual(["Alex M."]);

    vi.setSystemTime(new Date("2026-10-07T14:59:59Z"));
    expect(await loadOnShiftNames()).toEqual(["Alex M."]);
    vi.setSystemTime(new Date("2026-10-07T15:00:00Z"));
    expect(await loadOnShiftNames()).toEqual([]);
    expect(await getOwnShiftEnd(alex.user.id)).toBeNull();
    // The row is still there; it simply means nothing now.
    expect(await db.select().from(staffShifts)).toHaveLength(1);
  });
});

describe("who students see", () => {
  it("lists only the people on shift, never a student or an invented name", async () => {
    await signIn("admin", "alex@cornell.edu");
    await setMyShift({ onShift: true, until: "18:00" });
    await signIn("admin", "jordan@cornell.edu", "Jordan Park");
    await setMyShift({ onShift: true, until: "16:00" });
    await signIn("user", "casey@cornell.edu", "Casey Student");
    await setMyShift({ onShift: true, until: "18:00" });

    expect(await loadOnShiftNames()).toEqual(["Alex M.", "Jordan P."]);
  });

  it("stops showing somebody demoted or banned while on shift", async () => {
    const alex = await signIn("admin", "alex@cornell.edu");
    await setMyShift({ onShift: true, until: "18:00" });
    await db.update(user).set({ role: "user" }).where(eq(user.id, alex.user.id));
    expect(await loadOnShiftNames()).toEqual([]);

    await db.update(user).set({ role: "admin", banned: true }).where(eq(user.id, alex.user.id));
    expect(await loadOnShiftNames()).toEqual([]);
  });

  it("does not show somebody whose name is only their address, rather than show the address", async () => {
    await signIn("admin", "robin.q@cornell.edu", "robin.q@cornell.edu");
    expect(await setMyShift({ onShift: true, until: "18:00" })).toMatchObject({ ok: true });
    expect(await loadOnShiftNames()).toEqual([]);
  });

  it("names nobody, and fails nothing, when the roster cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(await import("../../lib/data/staff-shifts"), "listCurrentShifts").mockRejectedValueOnce(new Error("db down"));
    expect(await loadOnShiftNames()).toEqual([]);
    spy.mockRestore();
    error.mockRestore();
  });
});

it("is GUI only: the assistant never offers it, and MCP never sees it", () => {
  expect(SHIFTS_SET).toMatchObject({ id: "shifts.set", assistant: "never", mcp: "never", permission: "shifts.set" });
  expect(SHIFTS_SET.tool).toBeUndefined();
  expect(SHIFTS_SET.preview).toBeUndefined();
});
