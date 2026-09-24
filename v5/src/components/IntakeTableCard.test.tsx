import { render, screen, userEvent, within } from "../../test/utils/render";
import { IntakeTableCard } from "./IntakeTableCard";
import type {
  DuplicateOf,
  IntakeTablePayload,
  IntakeTableWarning,
  PendingToolView,
} from "../lib/intake/types";

/**
 * The intake table card (spec §5.4 step 5, §10): selection, inline edits,
 * duplicate decisions and the Research press. `fetch` is stubbed per test, so
 * what is asserted is exactly what the card sends and what it does with the
 * answer — the routes themselves are tested beside them.
 */

const BATCH = "0b7e3f7e-5c1a-4f64-9d2e-6a1b2c3d4e5f";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function row(id: string, name: string, over: Partial<PendingToolView> = {}): PendingToolView {
  return {
    id,
    batchId: BATCH,
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
    createdByName: "Niti Parikh",
    createdAt: "2026-09-23T12:00:00.000Z",
    updatedAt: "2026-09-23T12:00:00.000Z",
    ...over,
  };
}

function payload(items: PendingToolView[], warnings: IntakeTableWarning[] = []): IntakeTablePayload {
  return { kind: "intake-table", batchId: BATCH, items, warnings };
}

const THREE = [
  row(A, "Bambu Lab X1-Carbon Combo", { brand: "Bambu Lab", categoryHint: "3D Printing" }),
  row(B, "Glowforge Pro", { brand: "Glowforge" }),
  row(C, "Roland GS2-24"),
];

const TOOL_MATCH: DuplicateOf = {
  kind: "tool",
  id: "44444444-4444-4444-8444-444444444444",
  name: "Form 4",
  slug: "form-4",
  published: true,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The request the card made, parsed. */
function call(index = 0): { url: string; method?: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[index];
  return { url, method: init?.method, body: JSON.parse(String(init?.body)) };
}

function rowOf(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const tr = cell.closest("tr");
  if (!tr) throw new Error(`no row for ${name}`);
  return tr;
}

function researchButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Research selected/ });
}

describe("IntakeTableCard — selection", () => {
  it("starts with every row selected", () => {
    render(<IntakeTableCard payload={payload(THREE)} />);

    for (const item of THREE) {
      expect(screen.getByRole("checkbox", { name: `Select ${item.name}` })).toBeChecked();
    }
    const all = screen.getByRole("checkbox", { name: "Select all rows" }) as HTMLInputElement;
    expect(all).toBeChecked();
    expect(all.indeterminate).toBe(false);
    expect(researchButton()).toHaveTextContent("Research selected (3)");
  });

  it("selects some, none and all again from the header", async () => {
    const user = userEvent.setup();
    render(<IntakeTableCard payload={payload(THREE)} />);
    const all = screen.getByRole("checkbox", { name: "Select all rows" }) as HTMLInputElement;

    // Some.
    await user.click(screen.getByRole("checkbox", { name: "Select Glowforge Pro" }));
    expect(all).not.toBeChecked();
    expect(all.indeterminate).toBe(true);
    expect(researchButton()).toHaveTextContent("Research selected (2)");

    // All.
    await user.click(all);
    expect(all).toBeChecked();
    expect(all.indeterminate).toBe(false);
    expect(researchButton()).toHaveTextContent("Research selected (3)");

    // None.
    await user.click(all);
    expect(all).not.toBeChecked();
    for (const item of THREE) {
      expect(screen.getByRole("checkbox", { name: `Select ${item.name}` })).not.toBeChecked();
    }
    expect(researchButton()).toHaveTextContent("Research selected (0)");
    expect(researchButton()).toBeDisabled();
  });
});

describe("IntakeTableCard — editing a row", () => {
  it("sends only the changed field, and shows what the route answered", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(200, { item: { ...THREE[1], brand: "Glowforge Inc." } })
    );
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Edit Glowforge Pro" }));
    const brand = screen.getByRole("textbox", { name: "Brand" });
    await user.clear(brand);
    await user.type(brand, "Glowforge Inc.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call()).toEqual({
      url: `/api/pending-tools/${B}`,
      method: "PATCH",
      body: { brand: "Glowforge Inc." },
    });
    expect(within(rowOf("Glowforge Pro")).getByText("Glowforge Inc.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Brand" })).not.toBeInTheDocument();
  });

  it("sends a cleared field as null", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(200, { item: { ...THREE[0], categoryHint: null } }));
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Edit Bambu Lab X1-Carbon Combo" }));
    await user.clear(screen.getByRole("textbox", { name: "Category" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(call().body).toEqual({ categoryHint: null });
  });

  it("keeps the row and the typing when the save is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(409, { code: "not_editable", error: "This item is not editable." })
    );
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Edit Glowforge Pro" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Glowforge Plus");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This item has moved on — it may be researching, approved or discarded."
    );
    // The English `error` is never what the person reads.
    expect(screen.queryByText("This item is not editable.")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Glowforge Plus");
  });

  it("makes no request when nothing changed", async () => {
    const user = userEvent.setup();
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Edit Glowforge Pro" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(researchButton()).toBeEnabled();
  });

  it("removes a row", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(200, { item: { ...THREE[2], status: "discarded" } }));
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Remove Roland GS2-24" }));

    expect(call()).toEqual({ url: `/api/pending-tools/${C}`, method: "PATCH", body: { discard: true } });
    expect(screen.queryByText("Roland GS2-24")).not.toBeInTheDocument();
    expect(researchButton()).toHaveTextContent("Research selected (2)");
  });

  it("keeps a row whose removal was refused, and says why", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(403, { code: "forbidden", error: "Forbidden" }));
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Remove Roland GS2-24" }));

    expect(screen.getByText("Roland GS2-24")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You don’t have permission to change these items."
    );
  });
});

describe("IntakeTableCard — duplicates", () => {
  const dup = row(B, "Formlabs Form 4", { duplicateOf: TOOL_MATCH });

  it("cannot select an unresolved duplicate, and says why", () => {
    render(<IntakeTableCard payload={payload([THREE[0], dup])} />);

    const box = screen.getByRole("checkbox", { name: "Select Formlabs Form 4" });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(
      "Choose what to do with this duplicate before it can be researched."
    );
    expect(screen.getByRole("link", { name: "Form 4" })).toHaveAttribute("href", "/tools/form-4");
    expect(researchButton()).toHaveTextContent("Research selected (1)");
  });

  it("lists it as a different tool, and then selects it", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(200, { item: { ...dup, duplicateResolution: "new_tool" } }));
    render(<IntakeTableCard payload={payload([THREE[0], dup])} />);

    await user.click(screen.getByRole("button", { name: "It’s a different tool" }));

    expect(call()).toEqual({
      url: `/api/pending-tools/${B}`,
      method: "PATCH",
      body: { duplicateResolution: "new_tool" },
    });
    const box = screen.getByRole("checkbox", { name: "Select Formlabs Form 4" });
    expect(box).toBeEnabled();
    expect(box).toBeChecked();
    expect(screen.getByText("Listing as a separate tool")).toBeInTheDocument();
    expect(researchButton()).toHaveTextContent("Research selected (2)");
  });

  it("adds it as another unit with the serial number typed", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(200, { item: { ...dup, duplicateResolution: "add_unit", serialNumber: "F4-0099" } })
    );
    render(<IntakeTableCard payload={payload([THREE[0], dup])} />);

    await user.click(screen.getByRole("button", { name: "Add as another unit" }));
    // Choosing a unit is an edit in progress.
    expect(researchButton()).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Serial number" }), "F4-0099");
    await user.click(screen.getByRole("button", { name: "Add unit" }));

    expect(call().body).toEqual({ duplicateResolution: "add_unit", serialNumber: "F4-0099" });
    expect(screen.getByText("Adding as another unit of Form 4")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Formlabs Form 4" })).toBeChecked();
    expect(researchButton()).toBeEnabled();
  });

  it("removes a duplicate", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(json(200, { item: { ...dup, status: "discarded" } }));
    render(<IntakeTableCard payload={payload([THREE[0], dup])} />);

    await user.click(screen.getByRole("button", { name: "Remove Formlabs Form 4" }));

    expect(call().body).toEqual({ discard: true });
    expect(screen.queryByText("Formlabs Form 4")).not.toBeInTheDocument();
  });

  it("offers no unit for a match that is only another pending item", () => {
    const pendingDup = row(B, "Glowforge Pro", {
      duplicateOf: { kind: "pending", id: C, name: "Glowforge Pro", status: "identified" },
    });
    render(<IntakeTableCard payload={payload([pendingDup])} />);

    expect(screen.queryByRole("button", { name: "Add as another unit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "It’s a different tool" })).toBeInTheDocument();
    expect(screen.getByText("Already waiting for review: Glowforge Pro")).toBeInTheDocument();
  });
});

describe("IntakeTableCard — Research", () => {
  it("is disabled with nothing selected", async () => {
    const user = userEvent.setup();
    render(<IntakeTableCard payload={payload([THREE[0]])} />);

    await user.click(screen.getByRole("checkbox", { name: `Select ${THREE[0].name}` }));

    expect(researchButton()).toBeDisabled();
  });

  it("is disabled while a row is being edited, and again enabled after", async () => {
    const user = userEvent.setup();
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Edit Glowforge Pro" }));
    expect(researchButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(researchButton()).toBeEnabled();
  });

  it("is disabled while a row is saving", async () => {
    const user = userEvent.setup();
    let answer: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("button", { name: "Remove Roland GS2-24" }));
    expect(researchButton()).toBeDisabled();

    answer(json(200, { item: { ...THREE[2], status: "discarded" } }));
    expect(await screen.findByRole("button", { name: "Research selected (2)" })).toBeEnabled();
  });

  it("posts exactly the selected ids, and says research has started", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(202, { requestId: "r-1", runId: "run-1", queued: [A, C], readyAsUnit: [] })
    );
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(screen.getByRole("checkbox", { name: "Select Glowforge Pro" }));
    await user.click(researchButton());

    expect(call()).toEqual({
      url: "/api/pending-tools/research",
      method: "POST",
      body: { ids: [A, C] },
    });
    expect(
      screen.getByText(
        "Researching 2 tools — you can close this. Results will be on the Intake page."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Intake page" })).toHaveAttribute(
      "href",
      "/admin/intake"
    );
    // The row left behind is still identified, and the card says where it waits.
    expect(screen.getByText("1 unselected item waits on the Intake page.")).toBeInTheDocument();
    expect(within(rowOf("Roland GS2-24")).getByText("Queued")).toBeInTheDocument();
    // The table is done; nothing on it can be changed now.
    expect(screen.getByRole("button", { name: "Edit Glowforge Pro" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Research selected/ })).not.toBeInTheDocument();
  });

  it("says when an add-unit item skipped research", async () => {
    const user = userEvent.setup();
    const unit = row(B, "Formlabs Form 4", { duplicateOf: TOOL_MATCH, duplicateResolution: "add_unit" });
    fetchMock.mockResolvedValueOnce(
      json(202, { requestId: "r-1", runId: "run-1", queued: [A], readyAsUnit: [B] })
    );
    render(<IntakeTableCard payload={payload([THREE[0], unit])} />);

    await user.click(researchButton());

    expect(call().body).toEqual({ ids: [A, B] });
    expect(screen.getByText(/Researching 1 tool —/)).toBeInTheDocument();
    expect(
      screen.getByText("1 item skips research and is ready for review as another unit.")
    ).toBeInTheDocument();
  });

  it("shows a start_failed refusal and retries the same ids", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(
        json(502, { code: "start_failed", error: "Could not start research", ids: [A, B, C] })
      )
      .mockResolvedValueOnce(
        json(202, { requestId: "r-2", runId: "run-2", queued: [A, B, C], readyAsUnit: [] })
      );
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(researchButton());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Research couldn’t start. The items are saved and queued — press Retry."
    );
    // Queued rows cannot be edited; the only way on is the retry.
    expect(screen.getByRole("button", { name: "Edit Glowforge Pro" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).body).toEqual({ ids: [A, B, C] });
    expect(screen.getByText(/Researching 3 tools/)).toBeInTheDocument();
  });

  it("names the daily allowance left when the limit refuses", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      json(429, { code: "daily_limit", error: "Daily limit", remaining: 2 })
    );
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(researchButton());

    expect(screen.getByRole("alert")).toHaveTextContent("You can research 2 more today.");
    // Not a start failure: the table stays usable and the button returns.
    expect(researchButton()).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("treats a dropped connection as failed, never as started", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    render(<IntakeTableCard payload={payload(THREE)} />);

    await user.click(researchButton());

    expect(screen.getByRole("alert")).toHaveTextContent("That didn’t go through. Try again.");
    expect(screen.queryByText(/Researching/)).not.toBeInTheDocument();
  });
});

describe("IntakeTableCard — photos and warnings", () => {
  it("shows a public photo and names a private one it cannot show", () => {
    render(
      <IntakeTableCard
        payload={payload([
          row(A, "Bambu Lab X1-Carbon Combo", {
            photos: [
              {
                attachmentId: "p1",
                url: "https://store.public.blob.vercel-storage.com/uploads/tool/front.jpg",
                filename: "front.jpg",
              },
              { attachmentId: "p2", url: null, filename: "side.jpg" },
            ],
          }),
          row(B, "Glowforge Pro", {
            photos: [{ attachmentId: "p3", url: null, filename: "IMG_0001.jpg" }],
          }),
          row(C, "Roland GS2-24"),
        ])}
      />
    );

    expect(screen.getByRole("img", { name: "Photo of Bambu Lab X1-Carbon Combo" })).toHaveAttribute(
      "src",
      "https://store.public.blob.vercel-storage.com/uploads/tool/front.jpg"
    );
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("Photo not shown: IMG_0001.jpg")).toBeInTheDocument();
    expect(within(rowOf("Roland GS2-24")).getByText("No photo")).toBeInTheDocument();
  });

  it("renders each warning from its message key", () => {
    render(
      <IntakeTableCard payload={payload(THREE, ["photos_not_attached", "photos_not_public"])} />
    );

    expect(
      screen.getByText(
        "Some photos couldn’t be attached — they may have expired or already belong to something else."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Some photos are attached but can’t be shown here yet.")
    ).toBeInTheDocument();
  });
});
