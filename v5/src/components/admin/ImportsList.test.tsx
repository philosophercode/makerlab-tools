const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { ImportView } from "../../lib/import/view";
import { ImportsList } from "./ImportsList";

/**
 * The Imports section of `/admin/intake` on the shared table (bulk intake spec
 * §6; UI system spec §7.2): each import with its status as a word, its counts
 * as numbers, a link back into its review — and an unreadable list said, not
 * shown as empty.
 */

function view(overrides: Partial<ImportView> = {}): ImportView {
  return {
    id: "i1",
    status: "ready",
    format: "table",
    sourceKind: "csv",
    sourceName: "inventory-2026.csv",
    parseError: null,
    rowCount: 42,
    itemCount: 40,
    duplicateCount: 3,
    createdByName: "Niti",
    createdAt: "2026-09-24T12:00:00.000Z",
    ...overrides,
  };
}

it("lists each import with its status, counts and a link to its review", () => {
  render(<ImportsList imports={[view(), view({ id: "i2", status: "mapping", sourceName: null, sourceKind: "paste" })]} />);
  const table = screen.getByRole("table", { name: "Recent imports" });
  const csv = within(table).getByRole("row", { name: /inventory-2026\.csv/ });
  expect(within(csv).getByRole("link", { name: "inventory-2026.csv" })).toHaveAttribute("href", "/admin/intake/imports/i1");
  expect(csv).toHaveTextContent("Ready to review");
  expect(within(csv).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
    expect.arrayContaining(["40", "3", "Niti", "2026-09-24"])
  );
  // Not yet read into rows: counts are a dash, not a zero.
  const pasted = within(table).getByRole("row", { name: /Pasted list/ });
  expect(pasted).toHaveTextContent("Choose the columns");
  // Import a list is Add equipment's next tab now, not a button over the list.
  expect(screen.queryByRole("link", { name: "Import a list" })).not.toBeInTheDocument();
});

it("opens an import with Enter on its row", async () => {
  render(<ImportsList imports={[view()]} />);
  const row = within(screen.getByRole("table", { name: "Recent imports" })).getAllByRole("row")[1];
  row.focus();
  await userEvent.keyboard("{Enter}");
  expect(router.push).toHaveBeenCalledWith("/admin/intake/imports/i1");
});

it("says there are none, with the way to start one, and says when the list could not be read", () => {
  const { rerender } = render(<ImportsList imports={[]} />);
  expect(screen.getByText("No imports yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Import a list" })).toHaveAttribute("href", "/admin/intake/imports/new");
  rerender(<ImportsList imports={null} />);
  expect(screen.getByRole("alert")).toHaveTextContent("The imports could not be loaded right now.");
});
