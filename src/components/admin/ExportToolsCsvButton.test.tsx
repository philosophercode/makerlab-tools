import { render, screen, userEvent, within } from "../../../test/utils/render";
import { ExportToolsCsvButton, TOOLS_EXPORT_ENDPOINT, filenameFrom } from "./ExportToolsCsvButton";
import { InventoryBoard } from "./InventoryBoard";
import { NO_FILTERS } from "./inventory-filters";
import type { InventoryRow } from "../../lib/data/inventory";

/**
 * **Export CSV** on `/admin/inventory`: shown only when the page says the
 * viewer holds `catalog.export`, and it posts exactly the tools meant — every
 * tool, the filtered rows, or the selection.
 */

function row(id: string, name: string, state: InventoryRow["state"] = "published"): InventoryRow {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    officialName: null,
    photoUrl: null,
    categoryName: "Laser Cutting",
    categoryGroup: null,
    room: "Bloomberg 059",
    zone: null,
    unitCount: 1,
    worstUnitStatus: "available",
    state,
    openTicketCount: 0,
    openRefreshId: null,
    lastReviewedAt: null,
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    attention: { noPhoto: false, noManual: false, openTickets: false, neverReviewed: false, floorCheck: false },
    needsAttention: false,
  };
}

const ROWS = [row("a", "Form 4"), row("b", "Trotec Speedy 400", "draft"), row("c", "ShopBot Desktop", "archived")];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response("﻿ID\r\n", {
        status: 200,
        headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="makerlab-tools-2026-09-29.csv"' },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no object URLs; restored below so no other test sees these.
  URL.createObjectURL = vi.fn(() => "blob:csv");
  URL.revokeObjectURL = vi.fn();
  window.history.replaceState(null, "", "/admin/inventory");
});

const { createObjectURL, revokeObjectURL } = URL;
afterEach(() => {
  vi.unstubAllGlobals();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

/** The ids the last export posted, or "all" for an empty body. */
function postedIds(): string[] | "all" {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  expect(url).toBe(TOOLS_EXPORT_ENDPOINT);
  expect(init.method).toBe("POST");
  const body = JSON.parse(String(init.body)) as { ids?: string[] };
  return body.ids ?? "all";
}

describe("InventoryBoard — Export CSV", () => {
  it("is not offered without catalog.export, and there are no checkboxes for it", () => {
    render(<InventoryBoard rows={ROWS} initial={NO_FILTERS} />);
    expect(screen.queryByRole("button", { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Form 4" })).not.toBeInTheDocument();
  });

  it("exports every tool, every state, with no filter set", async () => {
    const user = userEvent.setup();
    render(<InventoryBoard rows={ROWS} initial={NO_FILTERS} canExport />);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(postedIds()).toBe("all");
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("exports what the filters leave when a filter is set", async () => {
    const user = userEvent.setup();
    render(<InventoryBoard rows={ROWS} initial={{ ...NO_FILTERS, state: "draft" }} canExport />);

    await user.click(screen.getByRole("button", { name: "Export CSV (1 shown)" }));

    expect(postedIds()).toEqual(["b"]);
  });

  it("exports exactly the selected tools", async () => {
    const user = userEvent.setup();
    render(<InventoryBoard rows={ROWS} initial={NO_FILTERS} canExport />);
    const table = screen.getByRole("table", { name: /Tools, their state/ });

    await user.click(within(table).getByRole("checkbox", { name: "Select Form 4" }));
    await user.click(within(table).getByRole("checkbox", { name: "Select ShopBot Desktop" }));
    await user.click(screen.getByRole("button", { name: "Export CSV (2)" }));

    expect(postedIds()).toEqual(["a", "c"]);
  });
});

describe("ExportToolsCsvButton", () => {
  it("says a refusal instead of saving a file", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error: "forbidden" }, { status: 403 }));
    const user = userEvent.setup();
    render(<ExportToolsCsvButton label="Export CSV" />);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only a super admin can export the tools.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("says a failure when the request itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    render(<ExportToolsCsvButton label="Export CSV" />);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The export could not be made. Try again.");
  });

  it("takes the file name from the response, and refuses a path in it", () => {
    expect(filenameFrom('attachment; filename="makerlab-tools-2026-09-29.csv"')).toBe("makerlab-tools-2026-09-29.csv");
    expect(filenameFrom('attachment; filename="../evil.csv"')).toBe("makerlab-tools.csv");
    expect(filenameFrom(null)).toBe("makerlab-tools.csv");
  });
});
