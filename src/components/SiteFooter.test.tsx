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

  it("starts with the lab's official logo, as decoration beside the words that name the lab", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    const logo = footer.querySelector('[data-slot="brand-logo"]');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(footer.querySelector("div")?.firstElementChild).toBe(logo);
  });
});
