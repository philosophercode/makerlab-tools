// @vitest-environment node
import { nextCacheMock } from "../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission, to prove the action asks for its own (`tools.edit`). */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions ? override.permissions.has(permission) : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { revalidatePath, revalidateTag } from "next/cache";
import { LAB_SET_NOTES } from "../../../../lib/actions/lab-notes";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { getLabSetting, LAB_NOTES_SETTING } from "../../../../lib/data/lab-settings";
import { getDb, resetDbForTests } from "../../../../lib/db/client";
import { labSettings, session } from "../../../../lib/db/schema/index";
import type { Db } from "../../../../lib/db/types";
import { getLabWideNotes } from "../../../../lib/lab-notes/read";
import { LAB_NOTES_MAX_CHARS } from "../../../../lib/lab-notes/setting";
import { signInAsNew } from "../../../../../test/utils/session";
import { saveLabNotes } from "./actions";

/**
 * `saveLabNotes` (identity spec amendment "Lab notes"): called directly, as a
 * server action can be, so `performAction`'s gate — signed in, then
 * `tools.edit` — and the definition's schema are all that stand in front of
 * the write.
 */

let db: Db;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "lab-notes-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(revalidatePath).mockClear();
  db = await getDb();
  await db.delete(labSettings);
  await db.delete(session);
});

afterEach(() => {
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
});

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const signedIn = await signInAsNew({ email, role });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

const NOTES = "Clean your station before you leave.\nAsk a SuperMaker before your first cut.";

it("refuses an anonymous caller and a student, storing nothing", async () => {
  setMockHeaders();
  expect(await saveLabNotes({ text: NOTES })).toEqual({ ok: false, error: "not_signed_in" });
  await signIn("user", "casey@cornell.edu");
  expect(await saveLabNotes({ text: NOTES })).toEqual({ ok: false, error: "not_permitted" });
  expect(await getLabSetting(LAB_NOTES_SETTING)).toBeNull();
});

it("asks for tools.edit, the permission that edits a tool's lab notes", async () => {
  await signIn("admin", "luis@cornell.edu");
  override.permissions = new Set(["insights.configure", "tools.add"]);
  expect(await saveLabNotes({ text: NOTES })).toEqual({ ok: false, error: "not_permitted" });
  override.permissions = new Set(["tools.edit"]);
  expect(await saveLabNotes({ text: NOTES })).toEqual({ ok: true });
});

it("stores the notes, normalised, with who set them, and drops the cache the chat reads them through", async () => {
  const admin = await signIn("admin", "luis@cornell.edu");
  expect(await saveLabNotes({ text: "  Clean your station before you leave.   \r\n\r\n\r\nAsk a SuperMaker before your first cut.\n" })).toEqual({ ok: true });

  const [row] = await db.select().from(labSettings);
  expect(row).toMatchObject({ key: LAB_NOTES_SETTING, updatedBy: admin.user.id, value: { text: "Clean your station before you leave.\n\nAsk a SuperMaker before your first cut." } });
  expect((await getLabSetting(LAB_NOTES_SETTING))?.updatedByName).toBeTruthy();
  expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog", expect.anything());
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/inventory/lab-notes");
  // What the chat then reads: one line per note.
  expect(await getLabWideNotes()).toEqual(["Clean your station before you leave.", "Ask a SuperMaker before your first cut."]);
});

it("treats saving the same notes again as no change: nothing refreshed", async () => {
  await signIn("super_admin", "niti@cornell.edu");
  expect(await saveLabNotes({ text: NOTES })).toEqual({ ok: true });
  vi.mocked(revalidateTag).mockClear();
  expect(await saveLabNotes({ text: `${NOTES}\n` })).toEqual({ ok: true });
  expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
});

it("clears the notes when saved empty", async () => {
  await signIn("admin", "luis@cornell.edu");
  await saveLabNotes({ text: NOTES });
  expect(await saveLabNotes({ text: "   " })).toEqual({ ok: true });
  expect(await getLabWideNotes()).toEqual([]);
});

it.each([
  ["text over the cap", { text: "x".repeat(LAB_NOTES_MAX_CHARS + 1) }],
  ["text that is not a string", { text: 42 }],
  ["no text at all", {}],
])("refuses %s with invalid_field, storing nothing", async (_name, input) => {
  await signIn("admin", "luis@cornell.edu");
  expect(await saveLabNotes(input as never)).toEqual({ ok: false, error: "invalid_field" });
  expect(await getLabSetting(LAB_NOTES_SETTING)).toBeNull();
});

it("is GUI only: the assistant never offers it, and MCP never sees it", () => {
  expect(LAB_SET_NOTES).toMatchObject({ id: "lab.set_notes", assistant: "never", mcp: "never", permission: "tools.edit" });
  expect(LAB_SET_NOTES.tool).toBeUndefined();
  expect(LAB_SET_NOTES.preview).toBeUndefined();
});
