import { SiteFooter } from "./SiteFooter";
import { render, screen, within } from "../../test/utils/render";

describe("SiteFooter", () => {
  it("links the product page, the quick start, About and MCP, and the lab's official page", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const nav = within(footer).getByRole("navigation", { name: "Site" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Product", "/product"],
      ["Quick start", "/product/quick-start"],
      ["About", "/about"],
      ["Connect an AI", "/mcp"],
    ]);
    expect(within(footer).getByRole("link", { name: "The MakerLAB at Cornell Tech" })).toHaveAttribute("href", "https://tech.cornell.edu/research/makerlab/");
  });
});
