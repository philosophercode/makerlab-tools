import { render, screen } from "../../../test/utils/render";
import type { EditorResource } from "../../lib/data/resources";
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
});
