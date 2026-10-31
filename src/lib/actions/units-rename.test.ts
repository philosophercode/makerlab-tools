// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../mirror/after-response", () => ({ requestMirrorPushAfterResponse: vi.fn(async () => undefined) }));

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { getDb, resetDbForTests } from "../db/client";
import { tools, units } from "../db/schema/index";
import { signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction } from "./proposals";
import { actionById } from "./registry";

/**
 * `rename_units` (assistant cleanup spec 2026-10-28 §5): one card renames
 * units of one tool or several, and the rows for one tool confirm in one click
 * because `units.rename` is chained (`revision-chain.ts`).
 */

let identity: Identity;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "units-rename-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  const signedIn = await signInAsNew({ email: "luis@cornell.edu", role: "admin", name: "Luis" });
  setMockHeaders({ cookie: signedIn.cookie });
  identity = await resolveIdentityFromHeaders();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

it("proposes one card for units of two tools and confirms every row, two of one tool included", async () => {
  const db = await getDb();
  const [prusa] = await db.insert(tools).values({ slug: "zq-prusa", name: "Zq Prusa" }).returning();
  const [form] = await db.insert(tools).values({ slug: "zq-form", name: "Zq Form" }).returning();
  const [p1, p2] = await db.insert(units).values([{ toolId: prusa.id, unitLabel: "prusa one" }, { toolId: prusa.id, unitLabel: "P2" }]).returning();
  const [f1] = await db.insert(units).values({ toolId: form.id, unitLabel: "form" }).returning();

  const proposed = await proposeAction(
    actionById("units.rename")!,
    { renames: [{ unit_id: p1.id, label: "Zq Prusa #1" }, { unit_id: p2.id, label: "Zq Prusa #2" }, { unit_id: f1.id, label: "Zq Form #1" }] },
    { identity, surface: "assistant", chatId: "chat-1" }
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) return;
  expect(proposed.proposals).toHaveLength(3);

  const results = await decideActionProposals({ ids: proposed.proposals.map((p) => p.id), decision: "confirm" }, identity);
  expect(results.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  const labels = (await db.select().from(units).where(eq(units.toolId, prusa.id))).map((u) => u.unitLabel).sort();
  expect(labels).toEqual(["Zq Prusa #1", "Zq Prusa #2"]);
  expect((await db.select().from(units).where(eq(units.id, f1.id)))[0].unitLabel).toBe("Zq Form #1");
});

it("refuses a unit id that names nothing, before any card", async () => {
  const proposed = await proposeAction(
    actionById("units.rename")!,
    { renames: [{ unit_id: "00000000-0000-0000-0000-000000000000", label: "X" }] },
    { identity, surface: "assistant", chatId: "chat-1" }
  );
  expect(proposed.ok).toBe(false);
});
