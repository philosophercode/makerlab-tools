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

const failing = vi.hoisted(() => ({ on: false }));
vi.mock("../../../../lib/usage/value/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/usage/value/load")>();
  return {
    ...actual,
    loadValueReport: async (...args: Parameters<typeof actual.loadValueReport>) => {
      if (failing.on) throw new Error("database unreachable");
      return actual.loadValueReport(...args);
    },
  };
});

import { isValidElement, type ReactElement } from "react";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { ValueAssumptionsForm } from "../../../../components/admin/insights/value/ValueAssumptionsForm";
import { ValueReportExport } from "../../../../components/admin/insights/value/ValueReportExport";
import { ValueReportView } from "../../../../components/admin/insights/value/ValueReportView";
import type { ValueReportViewModel } from "../../../../components/admin/insights/value/value-report-model";
import { EmptyState } from "../../../../components/system/EmptyState";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { resetDbForTests } from "../../../../lib/db/client";
import { labTimezone } from "../../../../lib/lab-time";
import { addDays, labClock } from "../../../../lib/usage/value/lab-clock";
import { signInAsNew } from "../../../../../test/utils/session";
import ValueReportPage from "./page";

/**
 * `/admin/insights/value`'s own gate and states (usage insight spec
 * amendment "Value report"): `insights.view` to read, the demo seed's
 * synthetic week in the current term, an error state that is never zeros.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-value-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  failing.on = false;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

const render = (search: Record<string, string> = {}) => ValueReportPage({ searchParams: Promise.resolve(search) }) as Promise<ReactElement>;

function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  return [node, ...elements(props.children)];
}

function find<P>(page: ReactElement, type: unknown): P | undefined {
  const all = elements(page);
  const header = all.flatMap((el) => elements((el.props as { actions?: unknown }).actions));
  return [...all, ...header].find((el) => el.type === type)?.props as P | undefined;
}

it("refuses an anonymous visitor and a student with the not-permitted notice", async () => {
  setMockHeaders();
  expect((await render()).type).toBe(AdminNotice);
  const student = await signInAsNew({ email: "casey-value@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });
  expect((await render()).type).toBe(AdminNotice);
});

it.each(["admin", "super_admin"] as const)("shows %s the current term's report from the demo week, the exports and editable assumptions", async (role) => {
  const person = await signInAsNew({ email: `${role}-value@cornell.edu`, role });
  setMockHeaders({ cookie: person.cookie });
  const page = await render();
  expect(page.type).not.toBe(AdminNotice);
  const view = find<{ model: ValueReportViewModel }>(page, ValueReportView);
  expect(view?.model.title).toMatch(/^MakerLAB AI — (Spring|Summer|Fall) \d{4} value report$/);
  expect(view?.model.cards.find((card) => card.key === "questionsAnswered")?.value).toMatch(/^\d/);
  const exportProps = find<{ csv: string; fileName: string }>(page, ValueReportExport);
  expect(exportProps?.fileName).toMatch(/^makerlab-ai-.*-value-report\.csv$/);
  expect(exportProps?.csv.split("\r\n")[0]).toMatch(/^Section,Metric,/);
  expect(find<{ canEdit: boolean }>(page, ValueAssumptionsForm)?.canEdit).toBe(true);
});

it("reads a custom range from the query string", async () => {
  const person = await signInAsNew({ email: "admin-value-range@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: person.cookie });
  const page = await render({ from: "2026-01-01", to: "2026-01-31" });
  expect(find<{ model: ValueReportViewModel }>(page, ValueReportView)?.model.title).toBe("MakerLAB AI — Jan 1, 2026 – Jan 31, 2026 value report");
});

it("counts the demo seed's synthetic week over the last eight days", async () => {
  const person = await signInAsNew({ email: "admin-value-week@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: person.cookie });
  const today = labClock(new Date(), labTimezone()).date;
  const page = await render({ from: addDays(today, -8), to: today });
  const cards = find<{ model: ValueReportViewModel }>(page, ValueReportView)!.model.cards;
  expect(Number(cards.find((card) => card.key === "questionsAnswered")!.value.replace(/,/g, ""))).toBeGreaterThan(0);
  expect(cards.find((card) => card.key === "staffHoursSaved")!.value).toMatch(/^\d+\.\d$/);
});

it("says the report could not be read, rather than showing zeros", async () => {
  const person = await signInAsNew({ email: "admin-value-error@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: person.cookie });
  failing.on = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const page = await render();
  expect(find(page, ValueReportView)).toBeUndefined();
  expect(elements(page).some((el) => el.type === EmptyState)).toBe(true);
});
