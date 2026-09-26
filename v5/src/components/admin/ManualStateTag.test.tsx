import { render, screen } from "../../../test/utils/render";
import type { EditorResource } from "../../lib/data/resources";
import { ManualStateCounts } from "./ManualStateCounts";
import { ManualStateTag } from "./ManualStateTag";
import { ResourcesEditor } from "./ResourcesEditor";

/** A resource row's manual processing state in the tool editor (manual text spec §5). */

describe("ManualStateTag", () => {
  it("says what happened to the manual's text, in words", () => {
    const cases: Array<[Parameters<typeof ManualStateTag>[0]["state"], string]> = [
      [{ state: "ready", pageCount: 212, reason: null }, "Text stored · 212 pages"],
      [{ state: "ready", pageCount: 1, reason: null }, "Text stored · 1 page"],
      [{ state: "no_text", pageCount: 16, reason: "no_text_layer" }, "No text (scanned)"],
      [{ state: "failed", pageCount: null, reason: "encrypted" }, "Failed: encrypted"],
      [{ state: "failed", pageCount: null, reason: "too_large" }, "Failed: too large"],
      [{ state: "failed", pageCount: null, reason: "corrupt" }, "Failed: unreadable file"],
      [{ state: "processing", pageCount: null, reason: null }, "Processing"],
    ];
    for (const [state, text] of cases) {
      const { unmount } = render(<ManualStateTag state={state} />);
      expect(screen.getByText(text)).toHaveAttribute("data-manual-state", state.state);
      unmount();
    }
  });

  it("shows on the editor's resource row when the resource holds a PDF, and not otherwise", () => {
    const base: EditorResource = { id: "r1", title: "Form 4 manual", type: "Manual", url: null, notes: null, published: true, fileUrls: [] };
    render(
      <ResourcesEditor
        resources={[{ ...base, manual: { state: "ready", pageCount: 57, reason: null } }, { ...base, id: "r2", title: "Video" }]}
        pending={false}
        onAdd={vi.fn()}
        onTogglePublished={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    expect(screen.getAllByText(/Text stored/)).toHaveLength(1);
    expect(screen.getByText("Text stored · 57 pages")).toBeInTheDocument();
  });

  it("says Searchable once the manual's passages are built (phase 2)", () => {
    render(<ManualStateTag state={{ state: "ready", pageCount: 212, reason: null, searchable: true }} />);
    expect(screen.getByText("Searchable · 212 pages")).toHaveAttribute("data-manual-state", "searchable");
  });

  it("offers Re-process on a row with a PDF, and calls back with the resource", async () => {
    const onReprocess = vi.fn(async () => true);
    const base: EditorResource = { id: "r1", title: "Form 4 manual", type: "Manual", url: null, notes: null, published: true, fileUrls: [] };
    render(
      <ResourcesEditor
        resources={[
          { ...base, manual: { state: "failed", pageCount: null, reason: "corrupt" } },
          { ...base, id: "r2", title: "Video" },
        ]}
        pending={false}
        onAdd={vi.fn()}
        onTogglePublished={vi.fn()}
        onRemove={vi.fn()}
        onReprocess={onReprocess}
      />
    );
    const buttons = screen.getAllByRole("button", { name: "Re-process" });
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(onReprocess).toHaveBeenCalledWith("r1");
  });
});

describe("ManualStateCounts", () => {
  it("lists the manual library by state, with pages and passages", () => {
    render(
      <ManualStateCounts counts={{ searchable: 12, textOnly: 2, noText: 3, failed: 1, processing: 4, pages: 2100, passages: 3050 }} />
    );
    const row = (key: string) => document.querySelector(`[data-manual-count="${key}"]`)?.textContent;
    expect(row("searchable")).toBe("Searchable12");
    expect(row("noText")).toBe("No text (scanned)3");
    expect(row("processing")).toBe("Processing4");
    expect(row("passages")).toBe("Search passages3050");
    expect(screen.getByText(/npm run manuals:index/)).toBeInTheDocument();
  });
});
