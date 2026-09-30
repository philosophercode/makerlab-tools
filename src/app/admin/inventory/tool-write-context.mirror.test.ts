// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

// The trigger has its own tests; here it is only asked whether it was called.
const mirror = vi.hoisted(() => ({ requestMirrorPush: vi.fn() }));

vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: mirror.requestMirrorPush }));

import { resetAuthForTests } from "../../../lib/auth/config";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, session, tools, units, user } from "../../../lib/db/schema/index";
import { signInAsNew } from "../../../../test/utils/session";
import { publish, saveTool } from "./actions";
import { withToolWrite } from "./tool-write-context";

/**
 * Every tool-editor write is a mirror trigger (spec §3.8 trigger 1:
 * "publishing, and saving an edit call `requestMirrorPush()`") — and only a
 * write that landed. `withToolWrite` is the one place that knows both, so it
 * is tested directly with a stand-in write, and once more through two real
 * actions so the wiring cannot come loose.
 */

const AUTH_SECRET = "tool-write-mirror-test-secret";

let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  mirror.requestMirrorPush.mockReset().mockResolvedValue(undefined);

  const db = await getDb();
  await db.delete(auditEvents);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);
  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", description: "before", published: false })
    .returning({ id: tools.id });
  toolId = row.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function asSuperMaker() {
  const signedIn = await signInAsNew({ email: "maker@cornell.edu", role: "admin", name: "Luis" });
  setMockHeaders({ cookie: signedIn.cookie });
}

async function input() {
  return { toolId, expectedRevision: (await readToolRevision(toolId))! };
}

describe("withToolWrite and the mirror", () => {
  it("requests a push after a write that landed", async () => {
    await asSuperMaker();

    const result = await withToolWrite("tools.edit", await input(), async (context) => ({
      ok: true as const,
      revision: context.expectedRevision,
    }));

    expect(result.ok).toBe(true);
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(1);
  });

  it("requests nothing after a refused write", async () => {
    await asSuperMaker();

    const result = await withToolWrite("tools.edit", await input(), async () => ({
      ok: false as const,
      error: "conflict" as const,
    }));

    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
  });

  it("requests nothing when the gate refuses, and never runs the write", async () => {
    setMockHeaders();
    const write = vi.fn();

    expect(await withToolWrite("tools.edit", await input(), write)).toEqual({ ok: false, error: "not_signed_in" });
    expect(write).not.toHaveBeenCalled();
    expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
  });

  it("requests a push from a real save and a real publish, and not from a stale save", async () => {
    await asSuperMaker();
    const stale = await input();

    expect((await saveTool({ ...stale, patch: { description: "after" } })).ok).toBe(true);
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(1);

    expect((await publish(await input())).ok).toBe(true);
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(2);

    // The first token is spent: a conflict, nothing written, nothing to mirror.
    expect(await saveTool({ ...stale, patch: { description: "again" } })).toMatchObject({ ok: false, error: "conflict" });
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(2);
  });
});
