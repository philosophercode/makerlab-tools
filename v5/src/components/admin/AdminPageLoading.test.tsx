import { render, screen } from "../../../test/utils/render";
import enMessages from "../../../messages/en.json";
import { AdminPageLoading } from "./AdminPageLoading";

describe("AdminPageLoading", () => {
  it("says it is loading, in words, once", () => {
    render(<AdminPageLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(enMessages.admin.loading);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it.each([
    ["tiles", 8],
    ["table", 0],
  ] as const)("is shaped like the page on its way: %s", (shape, tiles) => {
    const { container } = render(<AdminPageLoading shape={shape} />);
    expect(container.querySelector(`[data-shape="${shape}"]`)).not.toBeNull();
    expect(container.querySelectorAll(".h-36")).toHaveLength(tiles);
    // Decorative blocks are hidden from assistive technology.
    for (const block of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("draws a filter bar and table rows for a list", () => {
    const { container } = render(<AdminPageLoading shape="table" />);
    expect(container.querySelectorAll(".h-12")).toHaveLength(8);
  });
});
