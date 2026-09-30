import { render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import type { ManualLibraryRow } from "../../lib/data/manual-library";
import { ManualLibrary } from "./ManualLibrary";
import { ManualStateStrip } from "./ManualStateStrip";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** The Manuals page (public polish): the state strip, the table, its State facet and Re-process. */

const row = (over: Partial<ManualLibraryRow>): ManualLibraryRow => ({
  id: over.id ?? "a1",
  resourceId: over.resourceId ?? "r1",
  title: "Form 4 manual",
  toolId: "t1",
  toolName: "Form 4",
  toolSlug: "form-4",
  state: "searchable",
  pageCount: 212,
  passages: 400,
  reason: null,
  processedAt: new Date("2026-09-20T12:00:00Z"),
  ...over,
});

const ROWS: ManualLibraryRow[] = [
  row({}),
  row({ id: "a2", resourceId: "r2", title: "Trotec manual", toolName: "Laser cutter", toolSlug: "trotec", state: "failed", reason: "encrypted", pageCount: null, passages: 0 }),
  row({ id: "a3", resourceId: "r3", title: "Bandsaw scan", toolName: "Bandsaw", toolSlug: "bandsaw", state: "noText", passages: 0 }),
];

describe("ManualStateStrip", () => {
  it("puts each state's label on the left and its number on the right — no install instructions", () => {
    render(<ManualStateStrip counts={{ searchable: 12, textOnly: 2, noText: 3, failed: 1, processing: 0, pages: 2100, passages: 3050 }} />);
    const strip = document.querySelector('[data-slot="manual-state-strip"]') as HTMLElement;
    const pair = (key: string) => {
      const cell = strip.querySelector(`[data-manual-count="${key}"]`)!;
      return [within(cell as HTMLElement).getByRole("term").textContent?.replace(/[●▲■○◆–]/g, ""), cell.querySelector("dd")?.textContent];
    };
    expect(pair("searchable")).toEqual(["Searchable", "12"]);
    expect(pair("noText")).toEqual(["No text (scanned)", "3"]);
    expect(pair("processing")).toEqual(["Processing", "0"]);
    expect(pair("passages")).toEqual(["Search passages", "3050"]);
    expect(screen.queryByText(/npm/)).not.toBeInTheDocument();
  });
});

describe("ManualLibrary", () => {
  it("lists every manual with its tool and state, the failed one with its reason", () => {
    render(<ManualLibrary rows={ROWS} reprocess={vi.fn()} />);
    const table = within(screen.getByRole("table", { name: "Manuals, their tool and state" }));
    expect(table.getAllByRole("rowheader")).toHaveLength(3);
    expect(table.getByRole("link", { name: "Form 4" })).toHaveAttribute("href", "/tools/form-4");
    expect(table.getByText("Failed: encrypted")).toBeInTheDocument();
    expect(table.getByText("No text (scanned)")).toBeInTheDocument();
  });

  it("filters by state with counts per value, and names the filter that emptied the list", async () => {
    const user = userEvent.setup();
    render(<ManualLibrary rows={ROWS} reprocess={vi.fn()} />);
    await user.click(within(screen.getByRole("search")).getByRole("button", { name: /^State/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: /Failed/ })).toHaveTextContent("1");
    expect(within(menu).getByRole("menuitemradio", { name: /Processing/ })).toHaveAttribute("aria-disabled", "true");
    await user.click(within(menu).getByRole("menuitemradio", { name: /Failed/ }));
    const table = within(screen.getByRole("table", { name: "Manuals, their tool and state" }));
    expect(table.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Trotec manual"]);

    await user.type(screen.getByRole("searchbox", { name: "Search manuals" }), "zzz");
    expect(screen.getByText(/No manuals match "zzz" · State: Failed/)).toBeInTheDocument();
  });

  it("re-processes a manual from its row, with the outcome in the button", async () => {
    const user = userEvent.setup();
    const reprocess = vi.fn().mockResolvedValue({ ok: true });
    render(<ManualLibrary rows={ROWS} reprocess={reprocess} />);
    const table = within(screen.getByRole("table", { name: "Manuals, their tool and state" }));
    const button = table.getByRole("button", { name: "Re-process Trotec manual" });
    await user.click(button);
    expect(reprocess).toHaveBeenCalledWith({ resourceId: "r2" });
    await waitFor(() => expect(button).toHaveAttribute("data-state", "done"));
    expect(screen.getByText("Trotec manual will be read again shortly.")).toBeInTheDocument();
  });

  it("says why a re-process was refused, beside the button", async () => {
    const user = userEvent.setup();
    render(<ManualLibrary rows={ROWS} reprocess={vi.fn().mockResolvedValue({ ok: false, error: "not_permitted" })} />);
    const table = within(screen.getByRole("table", { name: "Manuals, their tool and state" }));
    await user.click(table.getByRole("button", { name: "Re-process Form 4 manual" }));
    expect(await table.findByRole("alert")).toHaveTextContent(/permission/i);
  });

  it("says there are no manuals yet, rather than drawing an empty table", () => {
    render(<ManualLibrary rows={[]} reprocess={vi.fn()} />);
    expect(screen.getByText(/No manuals yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
