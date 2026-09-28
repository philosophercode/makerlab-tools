/**
 * `/product/quick-start` (identity spec amendment 2026-09-28): eight
 * numbered steps with screenshots — the X1-Carbon question, a citation, a
 * report, then the staff steps, the kiosk and MCP — and things to try.
 */
import QuickStartPage, { metadata } from "./page";
import { QUICK_START_STEPS, THINGS_TO_TRY } from "../product-content";
import { render, screen, within } from "../../../../test/utils/render";

describe("/product/quick-start", () => {
  it("is titled Quick start, under the product page's crumb", () => {
    render(<QuickStartPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Quick start" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: /breadcrumb/i })).getByRole("link", { name: "Product" })).toHaveAttribute("href", "/product");
    expect(metadata.title).toBe("Quick start — MakerLAB Tools");
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/product/og.png" })]);
  });

  it("has 5–8 numbered steps, each with a heading and a described screenshot", () => {
    render(<QuickStartPage />);

    const steps = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"));
    expect(steps).toHaveLength(QUICK_START_STEPS.length);
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps.length).toBeLessThanOrEqual(8);
    steps.forEach((step, i) => {
      expect(step).toHaveTextContent(`Step ${i + 1}`);
      expect(within(step).getByRole("heading", { level: 2 })).toBeInTheDocument();
      expect(within(step).getByRole("img").getAttribute("alt")?.length).toBeGreaterThan(10);
    });
  });

  it("asks the X1-Carbon about the AMS, and walks staff through intake, people and the kiosk", () => {
    render(<QuickStartPage />);

    const ask = screen.getByRole("listitem", { name: "Ask the assistant on a tool page" });
    expect(ask).toHaveTextContent("“How do I start a print with the AMS?”");
    const intake = screen.getByRole("listitem", { name: "Add a tool from a photo" });
    expect(intake).toHaveTextContent("Staff");
    expect(intake).toHaveTextContent("Cornell Google account");
    expect(intake).toHaveTextContent("Admin → Intake");
    expect(screen.getByRole("listitem", { name: "Set up the lab screen" })).toHaveTextContent("Guided Access");
    expect(screen.getByRole("listitem", { name: "Connect Claude or ChatGPT" })).toHaveTextContent("/mcp");
  });

  it("lists things to try as links", () => {
    render(<QuickStartPage />);

    const tries = screen.getByRole("region", { name: "Things to try" });
    const links = within(tries).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(THINGS_TO_TRY.map((item) => item.href));
    expect(within(tries).getByRole("link", { name: /first print/ })).toHaveAttribute("href", "/tools/bambu-lab-x1-carbon-combo-3d-printer?ask=1");
    expect(screen.getByRole("link", { name: "Back to the product page" })).toHaveAttribute("href", "/product");
  });
});
