import { act, render, screen, within } from "../../../test/utils/render";
import type { ImportActions } from "../../app/admin/intake/imports/action-result";
import type { SourceRowsView } from "../../lib/import/rows";
import type { ImportItemView, ImportView } from "../../lib/import/view";
import { ImportProgress } from "./ImportProgress";
import { ImportReview } from "./ImportReview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/**
 * The import's progress (import progress spec 2026-10-27 §6, §10
 * "Component"): the stage line, the bar, the list as sent with waiting rows
 * leaving the Waiting list as they are identified, skipped rows with their
 * reason — and the review page polling only the changed rows while rows are
 * written, stopping when nothing moves.
 */

function view(over: Partial<ImportView> = {}): ImportView {
  return {
    id: "imp-1",
    status: "identifying",
    format: "table",
    sourceKind: "csv",
    sourceName: "lab.csv",
    parseError: null,
    rowCount: 4,
    itemCount: 1,
    duplicateCount: 0,
    progress: { total: 3, done: 1, skipped: [{ sourceRow: 3, reason: "no_name" }] },
    createdByName: "Niti",
    createdByRemoved: false,
    createdAt: "2026-10-27T00:00:00.000Z",
    ...over,
  };
}

function item(id: string, sourceRow: number, status: ImportItemView["status"] = "identified"): ImportItemView {
  return {
    id,
    batchId: "b",
    status,
    name: `Machine ${sourceRow}`,
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
    createdAt: "2026-10-27T00:00:00.000Z",
    updatedAt: "2026-10-27T00:00:00.000Z",
    sourceRow,
    quantity: 1,
    serials: [],
    labDocs: [],
    links: [],
    notes: null,
    nameSuggestion: null,
  };
}

const SKIPPED = [{ sourceRow: 3, reason: "no_name" as const }];

const SOURCE: SourceRowsView = {
  headers: ["Item", "Qty"],
  hidden: 0,
  rows: [
    { row: 2, cells: ["Bambu H2D", "1"] },
    { row: 3, cells: ["", "2"] },
    { row: 4, cells: ["Form 4", "1"] },
    { row: 5, cells: ["SawStop PCS", "1"] },
  ],
};

describe("ImportProgress", () => {
  it("says how many items are written, and lists the rows still waiting first", () => {
    render(<ImportProgress view={view()} items={[item("a", 2)]} source={SOURCE} />);
    expect(screen.getByRole("status")).toHaveTextContent("Identifying rows: 1 of 3 items written.");
    const bar = screen.getByRole("progressbar", { name: "Identifying rows" });
    expect(bar).toHaveAttribute("aria-valuenow", "33");

    const waiting = screen.getByRole("region", { name: "Waiting · 2" });
    expect(within(waiting).getAllByRole("listitem").map((li) => li.getAttribute("data-row"))).toEqual(["4", "5"]);
    expect(screen.getByText("Skipped: no name")).toBeInTheDocument();
  });

  it("empties the Waiting list as rows are identified", () => {
    const { rerender } = render(<ImportProgress view={view()} items={[item("a", 2)]} source={SOURCE} />);
    rerender(<ImportProgress view={view({ status: "ready", progress: { total: 3, done: 3, skipped: [{ sourceRow: 3, reason: "no_name" }] } })} items={[item("a", 2), item("b", 4), item("c", 5)]} source={SOURCE} />);
    expect(screen.queryByRole("region", { name: /Waiting/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 items to review · no possible duplicates · 1 row skipped");
  });

  it("follows research: running, queued and ready for approval", () => {
    render(
      <ImportProgress
        view={view({ status: "ready" })}
        items={[item("a", 2, "researching"), item("b", 4, "queued"), item("c", 5, "researched")]}
        source={SOURCE}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Researching: 1 running, 1 queued, 1 ready for approval.");
    expect(screen.getByText("Ready for approval")).toBeInTheDocument();
  });

  it("shows a document's parts read, and nothing while the columns are being chosen", () => {
    const { rerender } = render(<ImportProgress view={view({ status: "parsing", format: "document", progress: { chunks: 8, chunksDone: 3 } })} items={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading part 3 of 8…");
    rerender(<ImportProgress view={view({ status: "mapping" })} items={[]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("the review page's progress poll", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  function actions(progress: ImportActions["progress"]): ImportActions {
    const ok = async () => ({ ok: true as const, items: [] });
    return {
      load: vi.fn(async () => ({ ok: true as const, import: view(), items: [] })),
      progress,
      confirmColumns: vi.fn(async () => ({ ok: true as const, import: view(), items: [] })),
      updateRow: vi.fn(ok),
      setHints: vi.fn(ok),
      removeRows: vi.fn(ok),
      mergeRow: vi.fn(ok),
      acceptSuggestions: vi.fn(ok),
      ignoreSuggestions: vi.fn(ok),
      suggestNames: vi.fn(async () => ({ ok: true as const, requested: 0 })),
    };
  }

  it("asks for the rows changed since its last look, merges them, and stops once nothing moves", async () => {
    const progress = vi
      .fn<ImportActions["progress"]>()
      .mockResolvedValueOnce({ ok: true, import: view({ progress: { total: 3, done: 2, skipped: SKIPPED } }), items: [item("b", 4)], cursor: "c1" })
      .mockResolvedValueOnce({ ok: true, import: view({ status: "ready", progress: { total: 3, done: 3, skipped: SKIPPED } }), items: [item("c", 5)], cursor: "c2" });
    render(
      <ImportReview
        initialImport={view()}
        initialItems={[item("a", 2)]}
        preview={null}
        sourceHead={null}
        sourceRows={SOURCE}
        categories={[]}
        locations={[]}
        actions={actions(progress)}
      />
    );

    await act(async () => vi.advanceTimersByTimeAsync(3_100));
    expect(progress).toHaveBeenNthCalledWith(1, { importId: "imp-1", since: undefined });
    expect(screen.getByRole("region", { name: "Waiting · 1" })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(3_100));
    expect(progress).toHaveBeenNthCalledWith(2, { importId: "imp-1", since: "c1" });
    expect(screen.queryByRole("region", { name: /Waiting/ })).not.toBeInTheDocument();

    // Ready, nothing researching: the page stops asking.
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(progress).toHaveBeenCalledTimes(2);
  });
});
