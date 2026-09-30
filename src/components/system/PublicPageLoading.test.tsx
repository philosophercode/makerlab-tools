import { render, screen } from "../../../test/utils/render";
import enMessages from "../../../messages/en.json";
import { PublicPageLoading } from "./PublicPageLoading";

describe("PublicPageLoading (performance plan, quick win 5)", () => {
  it.each(["tool", "cards", "page"] as const)("says it is loading and draws the %s shape", (shape) => {
    const { container } = render(<PublicPageLoading shape={shape} />);
    expect(screen.getByRole("status")).toHaveTextContent(enMessages.ui.loading);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });
});
