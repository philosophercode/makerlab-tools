vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { fireEvent, render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import type { ImportActions } from "../../app/admin/intake/imports/action-result";
import type { ResearchPost } from "../../lib/import/research-queue";
import type { ImportItemView, ImportView } from "../../lib/import/view";
import { ImportCard } from "../ImportCard";
import { ImportMapping } from "./ImportMapping";
import { ImportReview } from "./ImportReview";
import { needsName, researchPlan, visibleRows } from "./import-table";

/**
 * The import page's islands (bulk intake spec §5, §6, §10 "Component"): the
 * mapping step, the review table — filters, bulk set, selection with
 * duplicates — and the chat's import card.
 */

const IMPORT: ImportView = {
  id: "imp-1",
  status: "ready",
  format: "table",
  sourceKind: "csv",
  sourceName: "inventory.csv",
  parseError: null,
  rowCount: 4,
  itemCount: 4,
  duplicateCount: 1,
  createdByName: "Niti",
  createdAt: "2026-09-24T00:00:00.000Z",
};

function row(id: string, name: string, over: Partial<ImportItemView> = {}): ImportItemView {
  return {
    id,
    batchId: "b",
    status: "identified",
    name,
    brand: null,
    categoryHint: null,
    locationHint: null,
    serialNumber: null,
    duplicateOf: null,
    duplicateResolution: null,
    photos: [],
    confidenceLevel: null,
    researchError: null,
    researchRequestedAt: null,
    hasWorkflowRun: false,
    createdByName: "Niti",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    sourceRow: Number(id.replace(/\D/g, "")) + 1,
    quantity: 1,
    serials: [],
    labDocs: [],
    links: [],
    notes: null,
    nameSuggestion: null,
    ...over,
  };
}

const ROWS: ImportItemView[] = [
  row("r1", "Formlabs Form 2", { brand: "Formlabs", labDocs: [{ title: "SOP", url: "https://docs.google.com/d/1" }] }),
  row("r2", "Heat gun", { nameSuggestion: { canonicalName: "Drill Master Heat Gun 1500W", brand: "Drill Master", confidence: "exact", sourceUrl: null, suggestedAt: "x" } }),
  row("r3", "Form-2", { duplicateOf: { kind: "pending", id: "r1", name: "Formlabs Form 2", status: "identified" } }),
  row("r4", "10 boxes of screws", { notes: "consumable?" }),
];

function actions(over: Partial<ImportActions> = {}): ImportActions {
  const ok = async () => ({ ok: true as const, items: [] });
  return {
    load: vi.fn(async () => ({ ok: true as const, import: IMPORT, items: ROWS })),
    confirmColumns: vi.fn(async () => ({ ok: true as const, import: IMPORT, items: ROWS })),
    updateRow: vi.fn(ok),
    setHints: vi.fn(async (input) => ({ ok: true as const, items: ROWS.filter((r) => input.ids.includes(r.id)).map((r) => ({ ...r, locationHint: input.locationHint ?? null })) })),
    removeRows: vi.fn(ok),
    mergeRow: vi.fn(ok),
    acceptSuggestions: vi.fn(ok),
    ignoreSuggestions: vi.fn(ok),
    suggestNames: vi.fn(async () => ({ ok: true as const, requested: 1 })),
    ...over,
  };
}

describe("the table's rules", () => {
  it("filters duplicates, names that need help, consumables and suggestions", () => {
    const none = new Set<string>();
    expect(visibleRows(ROWS, "duplicates", "", none).map((r) => r.id)).toEqual(["r3"]);
    expect(visibleRows(ROWS, "unnamed", "", none).map((r) => r.id)).toEqual(["r2"]);
    expect(visibleRows(ROWS, "consumables", "", none).map((r) => r.id)).toEqual(["r4"]);
    expect(visibleRows(ROWS, "suggested", "", none).map((r) => r.id)).toEqual(["r2"]);
    expect(visibleRows(ROWS, "all", "form", none).map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(needsName(row("x", "Prusa MK4"))).toBe(false);
  });

  it("sends only researchable, decided rows, and says why the rest wait", () => {
    const plan = researchPlan(ROWS, new Set(["r1", "r3", "r4"]));
    expect(plan).toEqual({ send: ["r1", "r4"], undecided: ["r3"], notResearchable: [] });
  });
});

describe("ImportMapping", () => {
  it("asks for the name column, then continues with the chosen matches", async () => {
    const onConfirm = vi.fn();
    render(
      <ImportMapping
        preview={{ headers: ["Thing", "Qty"], hasHeader: true, rows: [["Form 2", "2"]], rowCount: 1, suggested: [null, "quantity"] }}
        busy={false}
        error={null}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the column that holds each item's name.");
    const button = screen.getByRole("button", { name: /Continue with 1 row/ });
    expect(button).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("What the column “Thing” holds"), "name");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith(["name", "quantity"]);
  });
});

describe("ImportReview", () => {
  it("shows the rows, a same-import duplicate with its merge, lab documents and the suggestion", () => {
    render(<ImportReview initialImport={IMPORT} initialItems={ROWS} preview={null} sourceHead={null} categories={[]} locations={["Wood shop"]} actions={actions()} />);
    expect(screen.getByRole("heading", { name: "inventory.csv" })).toBeInTheDocument();
    expect(screen.getByText("Same as row 2")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Merge into row 2" })).toBeInTheDocument();
    const sop = screen.getByRole("link", { name: "SOP" });
    expect(sop).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Drill Master Heat Gun 1500W")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept all exact (1)" })).toBeInTheDocument();
  });

  it("filters to duplicates", async () => {
    render(<ImportReview initialImport={IMPORT} initialItems={ROWS} preview={null} sourceHead={null} categories={[]} locations={[]} actions={actions()} />);
    await userEvent.click(screen.getByRole("button", { name: "Duplicates" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByDisplayValue("Form-2")).toBeInTheDocument();
  });

  it("sets a location on the selected rows", async () => {
    const acts = actions();
    render(<ImportReview initialImport={IMPORT} initialItems={ROWS} preview={null} sourceHead={null} categories={[]} locations={[]} actions={acts} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Formlabs Form 2" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Heat gun" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Set location" }), "Wood shop");
    const applies = screen.getAllByRole("button", { name: "Apply" });
    await userEvent.click(applies[1]);
    expect(acts.setHints).toHaveBeenCalledWith({ importId: "imp-1", ids: ["r1", "r2"], locationHint: "Wood shop" });
    expect(await screen.findByText("Updated 2 rows.")).toBeInTheDocument();
  });

  it("researches the decided rows in chunks and says what waits and what needs a decision", async () => {
    const post: ResearchPost = vi.fn(async (ids: string[]) => ({
      ok: false as const,
      status: 429,
      body: { code: "daily_limit" as const, error: "", remaining: 0 },
    }));
    render(<ImportReview initialImport={IMPORT} initialItems={ROWS} preview={null} sourceHead={null} categories={[]} locations={[]} actions={actions()} post={post} />);
    await userEvent.click(screen.getByRole("button", { name: "Select all shown" }));
    const research = screen.getByRole("button", { name: "Research selected (3)" });
    await userEvent.click(research);
    await waitFor(() => expect(post).toHaveBeenCalledWith(["r1", "r2", "r4"]));
    expect(await screen.findByText(/3 wait for tomorrow's allowance or a setup allowance/)).toBeInTheDocument();
    expect(screen.getByText("1 has a possible duplicate to decide first.")).toBeInTheDocument();
  });

  it("saves a renamed row when its box loses focus", async () => {
    const acts = actions();
    render(<ImportReview initialImport={IMPORT} initialItems={ROWS} preview={null} sourceHead={null} categories={[]} locations={[]} actions={acts} />);
    const box = screen.getByLabelText("Name, row 3");
    fireEvent.change(box, { target: { value: "Drill Master Heat Gun" } });
    fireEvent.blur(box);
    await waitFor(() => expect(acts.updateRow).toHaveBeenCalledWith({ importId: "imp-1", id: "r2", patch: { name: "Drill Master Heat Gun" } }));
  });

  it("says when a document named no equipment, with its first lines", () => {
    render(
      <ImportReview
        initialImport={{ ...IMPORT, status: "failed", parseError: "no_items" }}
        initialItems={[]}
        preview={null}
        sourceHead={["Meeting notes", "Tidy the shelves"]}
        categories={[]}
        locations={[]}
        actions={actions()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("No equipment found in this document.");
    expect(screen.getByText(/Tidy the shelves/)).toBeInTheDocument();
  });
});

describe("ImportCard (the chat hand-off)", () => {
  it("says how many items were found, the duplicates, and links to the review", () => {
    render(<ImportCard payload={{ kind: "import-card", import: { ...IMPORT, itemCount: 42, duplicateCount: 3 }, href: "/admin/intake/imports/imp-1" }} />);
    expect(screen.getByText("42 items found (3 possible duplicates)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review import" })).toHaveAttribute("href", "/admin/intake/imports/imp-1");
  });

  it("asks for the columns when the table's name column was not plain", () => {
    render(<ImportCard payload={{ kind: "import-card", import: { ...IMPORT, status: "mapping" }, href: "/x" }} />);
    expect(screen.getByText("Match the columns to create the rows.")).toBeInTheDocument();
  });
});
