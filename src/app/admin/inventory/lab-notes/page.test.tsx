// @vitest-environment node
import { nextCacheMock } from "../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../../messages/en.json")).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }) };
});

import Link from "next/link";
import { isValidElement, type ReactElement } from "react";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader, type AdminPageHeaderProps } from "../../../../components/admin/AdminPageHeader";
import { LabNotesForm, type LabNotesFormProps } from "../../../../components/admin/lab-notes/LabNotesForm";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { LAB_NOTES_SETTING, setLabSetting } from "../../../../lib/data/lab-settings";
import { getDb, resetDbForTests } from "../../../../lib/db/client";
import { labSettings, tools } from "../../../../lib/db/schema/index";
import { signInAsNew } from "../../../../../test/utils/session";
import { saveLabNotes } from "./actions";
import AdminLabNotesPage from "./page";

/**
 * `/admin/inventory/lab-notes` (identity spec amendment "Lab notes"): its own
 * gate, `tools.edit`; the lab-wide notes in the form; every unarchived tool
 * with lab notes listed under it, drafts marked.
 */

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-lab-notes-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  await (await getDb()).delete(labSettings);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  vi.unstubAllEnvs();
});

function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: unknown }).children)];
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!isValidElement(node)) return "";
  return text((node.props as { children?: unknown }).children);
}

const render = () => AdminLabNotesPage() as Promise<ReactElement>;

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const person = await signInAsNew({ email, role });
  setMockHeaders({ cookie: person.cookie });
  return person;
}

it("refuses an anonymous visitor and a student with the not-permitted notice", async () => {
  setMockHeaders();
  expect((await render()).type).toBe(AdminNotice);
  await signIn("user", "casey-notes@cornell.edu");
  const page = await render();
  expect(page.type).toBe(AdminNotice);
  expect((page.props as { kind: string }).kind).toBe("forbidden");
});

it("hands the form an empty box when there are no lab-wide notes yet, with the save action", async () => {
  await signIn("admin", "luis-notes@cornell.edu");
  const form = elements(await render()).find((el) => el.type === LabNotesForm)?.props as LabNotesFormProps;

  expect(form.initial).toBe("");
  expect(form.save).toBe(saveLabNotes);
});

it("hands the form the stored notes and says how many there are and who changed them", async () => {
  const person = await signIn("super_admin", "niti-notes@cornell.edu");
  await setLabSetting(LAB_NOTES_SETTING, { text: "Clean your station.\n\nPut tools back." }, person.user.id);
  const tree = elements(await render());

  expect((tree.find((el) => el.type === LabNotesForm)?.props as LabNotesFormProps).initial).toBe("Clean your station.\n\nPut tools back.");
  const facts = (tree.find((el) => el.type === AdminPageHeader)?.props as AdminPageHeaderProps).facts ?? [];
  expect(facts).toContain("2 lab-wide notes");
  expect(facts.find((fact) => typeof fact === "string" && fact.startsWith("Changed "))).toMatch(/^Changed \d{4}-\d{2}-\d{2} by /);
});

it("lists every unarchived tool with lab notes, drafts marked, and none without", async () => {
  const db = await getDb();
  await db.insert(tools).values([
    { slug: "box-cutter", name: "Box cutter", published: false, notes: "- Always put a cutting mat underneath.\nReturn the blade." },
    { slug: "old-saw", name: "Old saw", published: true, notes: "Retired.", archivedAt: new Date("2026-01-01T00:00:00.000Z") },
    { slug: "blank-drill", name: "Blank drill", published: true, notes: "  \n " },
  ]);
  await signIn("admin", "luis-notes@cornell.edu");
  const tree = elements(await render());
  const links = tree.filter((el) => el.type === Link).map((el) => (el.props as { href: string }).href);

  // The demo seed's two tools have lab notes; the box cutter is a draft.
  expect(links).toEqual(["/tools/box-cutter", "/tools/form-4", "/tools/trotec-speedy-400"]);
  const page = text(await render());
  expect(page).toContain("Always put a cutting mat underneath.");
  expect(page).toContain("Return the blade.");
  expect(page).toContain("Draft");
  expect(page).not.toContain("Retired.");
  const facts = (tree.find((el) => el.type === AdminPageHeader)?.props as AdminPageHeaderProps).facts ?? [];
  expect(facts).toContain("No lab-wide notes");
  expect(facts).toContain("3 tools with lab notes");
});
