// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { session, tools, units, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { loadToolForEditor, saveTool } from "./actions";
import { addUnit } from "./unit-actions";

/**
 * Two panels, one tool (spec §5.3(4)).
 *
 * The scenario the whole revision token exists for: somebody opens the editor,
 * somebody else saves, and then the first person saves. **Nothing of the second
 * writer's work may be lost, and the first person must be told** — never a
 * silent overwrite, and never a partial one.
 *
 * Its own file because every test in it stages the same race, and because the
 * staging is the fiddly part: PGlite's `now()` is millisecond-resolution, so
 * "somebody else" landing in the same millisecond as the token would leave the
 * token still matching. Each test moves `updated_at` explicitly with the
 * trigger disabled rather than racing the clock.
 */

const AUTH_SECRET = "inventory-conflict-test-secret";

let db: Db;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  vi.mocked(revalidatePath).mockClear();

  db = await getDb();
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", description: "before" })
    .returning({ id: tools.id });
  toolId = row.id;

  const maker = await signInAsNew({ email: "maker@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: maker.cookie });
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

/** The other editor saves, at a timestamp this one cannot share. */
async function somebodyElseSaves(description: string) {
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(
    sql`update tools set description = ${description}, updated_at = updated_at + interval '1 second'`
  );
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);
}

async function toolRow() {
  return (await db.select().from(tools).where(eq(tools.id, toolId)))[0];
}

it("refuses the second save, keeps the other writer's value, and busts no cache", async () => {
  const opened = await loadToolForEditor("form-4");
  if (!opened.ok) throw new Error("expected the panel to open");

  await somebodyElseSaves("somebody else");

  const result = await saveTool({
    toolId,
    expectedRevision: opened.editor.tool.revision,
    patch: { description: "mine" },
  });

  expect(result).toEqual({ ok: false, error: "conflict" });
  // Their work survives intact — a conflict is never a silent overwrite, and
  // the panel still holds "mine" to offer back to the person who typed it.
  expect((await toolRow()).description).toBe("somebody else");
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("refuses a child write on a stale token too, and adds nothing", async () => {
  const opened = await loadToolForEditor("form-4");
  if (!opened.ok) throw new Error("expected the panel to open");

  await somebodyElseSaves("somebody else");

  // A unit write touches its tool in the same transaction, so it is checked
  // against the same token — and a refusal rolls that touch back.
  expect(
    await addUnit({
      toolId,
      expectedRevision: opened.editor.tool.revision,
      unit: { unitLabel: "Form 4 #2" },
    })
  ).toEqual({ ok: false, error: "conflict" });

  expect(await db.select().from(units)).toEqual([]);
});

it("lets the same person save again once they reload into the newer version", async () => {
  const opened = await loadToolForEditor("form-4");
  if (!opened.ok) throw new Error("expected the panel to open");

  await somebodyElseSaves("somebody else");
  expect(
    (
      await saveTool({
        toolId,
        expectedRevision: opened.editor.tool.revision,
        patch: { description: "mine" },
      })
    ).ok
  ).toBe(false);

  // What the panel's Reload button does: read the tool again, take the new
  // token, and keep the unsaved text the person typed.
  const reloaded = await loadToolForEditor("form-4");
  if (!reloaded.ok) throw new Error("expected the panel to reload");
  expect(reloaded.editor.tool.description).toBe("somebody else");

  const saved = await saveTool({
    toolId,
    expectedRevision: reloaded.editor.tool.revision,
    patch: { description: "mine" },
  });

  expect(saved.ok).toBe(true);
  expect((await toolRow()).description).toBe("mine");
});

it("tells a deleted tool apart from a conflict, because the panel says something else", async () => {
  const opened = await loadToolForEditor("form-4");
  if (!opened.ok) throw new Error("expected the panel to open");

  await db.delete(tools).where(eq(tools.id, toolId));

  expect(
    await saveTool({
      toolId,
      expectedRevision: opened.editor.tool.revision,
      patch: { description: "mine" },
    })
  ).toEqual({ ok: false, error: "not_found" });
});
