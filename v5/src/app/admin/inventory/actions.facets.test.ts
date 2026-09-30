// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, session, tools, units, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { loadToolForEditor, saveTool } from "./actions";

/**
 * The tool editor's taxonomy v2 facets — Item kind and Accessory of — through
 * the same server action and revision check as every other field.
 */

let db: Db;
const ids: Record<string, string> = {};

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "inventory-facets-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();

  db = await getDb();
  await db.delete(auditEvents);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  for (const [slug, name] of [
    ["makita-rt0701c", "Makita Compact Router"],
    ["makita-plunge-base", "Makita Plunge Base"],
    ["old-router", "Old Router"],
  ] as const) {
    const [row] = await db.insert(tools).values({ slug, name, published: true }).returning({ id: tools.id });
    ids[slug] = row.id;
  }
  await db.update(tools).set({ archivedAt: new Date() }).where(eq(tools.slug, "old-router"));
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function asSuperMaker() {
  const signedIn = await signInAsNew({ email: "maker@cornell.edu", role: "admin", name: "Luis" });
  setMockHeaders({ cookie: signedIn.cookie });
}

async function row(slug: string) {
  const [found] = await db.select().from(tools).where(eq(tools.slug, slug));
  return found;
}

describe("tool editor facets", () => {
  it("opens with the tool's facets and the tools it may be an accessory of", async () => {
    await asSuperMaker();
    const result = await loadToolForEditor("makita-plunge-base");
    if (!result.ok) throw new Error("expected the panel to open");
    expect(result.editor.tool.itemKind).toBe("equipment");
    expect(result.editor.tool.parentToolId).toBeNull();
    // Not itself, not an archived tool.
    expect(result.editor.parentOptions?.map((option) => option.name)).toEqual(["Makita Compact Router"]);
  });

  it("saves Item kind and Accessory of with the revision check", async () => {
    await asSuperMaker();
    const opened = await loadToolForEditor("makita-plunge-base");
    if (!opened.ok) throw new Error("expected the panel to open");

    const saved = await saveTool({
      toolId: ids["makita-plunge-base"],
      expectedRevision: opened.editor.tool.revision,
      patch: { itemKind: "accessory", parentToolId: ids["makita-rt0701c"] },
    });
    expect(saved.ok).toBe(true);
    const base = await row("makita-plunge-base");
    expect(base.itemKind).toBe("accessory");
    expect(base.parentToolId).toBe(ids["makita-rt0701c"]);
    if (saved.ok) expect(saved.editor?.tool.itemKind).toBe("accessory");

    // The spent token is refused: nothing written.
    const stale = await saveTool({
      toolId: ids["makita-plunge-base"],
      expectedRevision: opened.editor.tool.revision,
      patch: { itemKind: "consumable" },
    });
    expect(stale).toEqual({ ok: false, error: "conflict" });
    expect((await row("makita-plunge-base")).itemKind).toBe("accessory");
  });

  it("clears Accessory of with null", async () => {
    await asSuperMaker();
    await db.update(tools).set({ parentToolId: ids["makita-rt0701c"] }).where(eq(tools.slug, "makita-plunge-base"));
    const revision = (await readToolRevision(ids["makita-plunge-base"], { db }))!;
    const saved = await saveTool({ toolId: ids["makita-plunge-base"], expectedRevision: revision, patch: { parentToolId: null } });
    expect(saved.ok).toBe(true);
    expect((await row("makita-plunge-base")).parentToolId).toBeNull();
  });

  it("refuses an unknown kind, the tool itself, a chain, and a parent that has accessories", async () => {
    await asSuperMaker();
    const tryPatch = async (slug: string, patch: Parameters<typeof saveTool>[0]["patch"]) =>
      saveTool({ toolId: ids[slug], expectedRevision: (await readToolRevision(ids[slug], { db }))!, patch });

    expect(await tryPatch("makita-plunge-base", { itemKind: "gadget" as never })).toEqual({ ok: false, error: "invalid_field" });
    expect(await tryPatch("makita-plunge-base", { parentToolId: ids["makita-plunge-base"] })).toEqual({ ok: false, error: "invalid_field" });
    expect(await tryPatch("makita-plunge-base", { parentToolId: "not-a-uuid" })).toEqual({ ok: false, error: "invalid_field" });

    // The base becomes the router's accessory; now nothing may hang off the base,
    // and the router (which has an accessory) may not become one.
    expect((await tryPatch("makita-plunge-base", { parentToolId: ids["makita-rt0701c"] })).ok).toBe(true);
    expect(await tryPatch("old-router", { parentToolId: ids["makita-plunge-base"] })).toEqual({ ok: false, error: "invalid_field" });
    expect(await tryPatch("makita-rt0701c", { parentToolId: ids["old-router"] })).toEqual({ ok: false, error: "invalid_field" });
    expect((await row("makita-rt0701c")).parentToolId).toBeNull();
  });
});
