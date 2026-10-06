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

import { isValidElement, type ReactElement } from "react";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { QrLabelStudio, type QrLabelStudioProps } from "../../../../components/admin/qr/QrLabelStudio";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../../lib/db/client";
import { eq } from "drizzle-orm";
import { tools, units } from "../../../../lib/db/schema/index";
import { signInAsNew } from "../../../../../test/utils/session";
import AdminQrLabelsPage from "./page";

/**
 * `/admin/inventory/qr`'s own gate (QR labels): `tools.edit`, the inventory's
 * permission — refused, and told so, to a visitor and a student; admins and
 * super admins get the published tools only, with the production origin.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-qr-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tools.example.edu");
  resetAuthForTests();
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

const render = () => AdminQrLabelsPage() as Promise<ReactElement>;

it("refuses an anonymous visitor and a student with the not-permitted notice", async () => {
  setMockHeaders();
  expect((await render()).type).toBe(AdminNotice);
  const student = await signInAsNew({ email: "casey-qr@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });
  const page = await render();
  expect(page.type).toBe(AdminNotice);
  expect((page.props as { kind: string }).kind).toBe("forbidden");
});

it.each(["admin", "super_admin"] as const)("gives %s the published tools, never a draft or an archived one", async (role) => {
  const db = await getDb();
  await db.insert(tools).values([
    { slug: "draft-drill", name: "Draft drill", published: false },
    { slug: "old-mill", name: "Old mill", published: true, archivedAt: new Date("2026-01-01T00:00:00.000Z") },
  ]);
  const person = await signInAsNew({ email: `${role}-qr@cornell.edu`, role });
  setMockHeaders({ cookie: person.cookie });

  const page = await render();
  expect(page.type).not.toBe(AdminNotice);
  const studio = elements(page).find((el) => el.type === QrLabelStudio)?.props as QrLabelStudioProps;
  expect(studio.rows.map((row) => row.slug).sort()).toEqual(["form-4", "trotec-speedy-400"]);
  expect(studio.origin).toBe("https://tools.example.edu");
  expect(studio.wordmarkHref).toBe("/makerlab-wordmark.png");
});

it("hands each tool its units for unit labels, never a retired one (amendment 2026-10-06)", async () => {
  const db = await getDb();
  const [form4] = await db.select().from(tools).where(eq(tools.slug, "form-4"));
  await db.insert(units).values({ toolId: form4.id, unitLabel: "Form 4 // Old", status: "retired" });
  const person = await signInAsNew({ email: "admin-qr-units@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: person.cookie });

  const studio = elements(await render()).find((el) => el.type === QrLabelStudio)?.props as QrLabelStudioProps;
  const form4Row = studio.rows.find((row) => row.slug === "form-4")!;
  expect(form4Row.units?.map((unit) => unit.name)).toEqual(["Form 4 // A"]);
  expect(form4Row.units?.[0].id).toMatch(/^[0-9a-f-]{36}$/);
});
