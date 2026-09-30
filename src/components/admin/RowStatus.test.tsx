import { render, screen } from "../../../test/utils/render";
import { RowStatus } from "./RowStatus";

/**
 * The one inline outcome line (DESIGN.md §8.9): codes in their contract's
 * order, or a worded message in a tone — always a live region, empty until it
 * has something to say.
 */

describe("RowStatus — codes", () => {
  it("says Saving while pending, then Saved", () => {
    const { rerender } = render(<RowStatus pending saved={false} error={null} warning={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    rerender(<RowStatus pending={false} saved error={null} warning={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "muted");
  });

  it("never says Saved beside a warning or a refusal", () => {
    const { rerender } = render(<RowStatus pending={false} saved error={null} warning="audit_unavailable" />);
    expect(screen.getByRole("status")).toHaveTextContent(/could not be written to the audit log/);
    expect(screen.getByRole("status")).not.toHaveTextContent(/^Saved$/);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "warn");
    rerender(<RowStatus pending={false} saved error="not_permitted" warning={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(/does not hold the permission/);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "bad");
  });

  it("is in the DOM, empty, before there is anything to say", () => {
    render(<RowStatus pending={false} saved={false} error={null} warning={null} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("RowStatus — a worded message", () => {
  it("carries the caller's words in its tone, as an alert when asked", () => {
    render(
      <RowStatus tone="bad" role="alert">
        That file is too large.
      </RowStatus>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("That file is too large.");
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "bad");
  });
});
