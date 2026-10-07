import { siteConfig } from "../lib/site-config";
import { render } from "../../test/utils/render";
import { BrandLogo } from "./BrandLogo";

/**
 * The lab's official logo (identity spec amendment 2026-10-06): one SVG,
 * drawn as a mask in the text colour so it reads on both themes, and hidden
 * from assistive technology because the words beside it name the lab.
 */
describe("BrandLogo", () => {
  it("masks the official logo file, as decoration, at the size the caller gives", () => {
    const { container } = render(<BrandLogo className="h-10" />);
    const logo = container.querySelector('[data-slot="brand-logo"]') as HTMLElement;

    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).toHaveClass("brand-logo", "h-10");
    expect(siteConfig.logo).toBe("/brand/cornell-tech-makerlab-logo.svg");
    expect(logo.style.maskImage || logo.getAttribute("style")).toContain("/brand/cornell-tech-makerlab-logo.svg");
  });
});
