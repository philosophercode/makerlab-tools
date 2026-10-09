vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator, createFormatter } = await import("next-intl");
  const messages = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
    getFormatter: async () => createFormatter({ locale: "en" }),
  };
});
const names = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock("../../lib/on-shift/read", () => ({ loadOnShiftNames: vi.fn(async () => names.value) }));

import type { ReactElement } from "react";
import { connection } from "next/server";
import { render, screen } from "../../../test/utils/render";
import { OnShiftNow } from "./OnShiftNow";

/**
 * "On shift now: Alex M." on the home page and a tool page (on-shift spec
 * 2026-10-07 §6): the names joined as a sentence, and nothing at all when
 * nobody is on shift. Dynamic before it reads the clock.
 */

async function renderLine() {
  const element = (await OnShiftNow({})) as ReactElement | null;
  return element ? render(element) : null;
}

it("says who is on shift, joined as a sentence", async () => {
  names.value = ["Alex M.", "Jordan P."];
  await renderLine();
  expect(screen.getByText("On shift now: Alex M. and Jordan P.")).toBeInTheDocument();
  expect(vi.mocked(connection)).toHaveBeenCalled();
});

it("renders nothing at all when nobody is on shift: no stand-in name, no 'nobody'", async () => {
  names.value = [];
  expect(await renderLine()).toBeNull();
});
