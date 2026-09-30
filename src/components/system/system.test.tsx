import { render, screen, within } from "../../../test/utils/render";
import { Button } from "../ui/button";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { Sparkline } from "./Sparkline";
import { STATUS_TONES, StatusGlyph } from "./StatusGlyph";

/**
 * The app-level primitives phase 1 ships (UI system spec §7.2, §14): status is
 * never colour alone, a sparkline says in words what it draws, a page header
 * names its breadcrumb, and an empty state carries its sentence and action.
 */

describe("StatusGlyph", () => {
  it("pairs a distinct shape with a visible word for every tone", () => {
    const glyphs = STATUS_TONES.map((tone) => {
      const { container, unmount } = render(<StatusGlyph tone={tone} label={`word-${tone}`} />);
      expect(screen.getByText(`word-${tone}`)).toBeVisible();
      expect(screen.getByText(`word-${tone}`)).not.toHaveClass("sr-only");
      const glyph = container.querySelector(`[data-glyph="${tone}"]`)!;
      expect(glyph).toHaveAttribute("aria-hidden", "true");
      const shape = glyph.textContent;
      unmount();
      return shape;
    });
    // Shape carries the meaning as well as colour: six tones, six shapes.
    expect(new Set(glyphs).size).toBe(STATUS_TONES.length);
  });

  it("keeps the word for screen readers and as a tooltip when compact", () => {
    const { container } = render(<StatusGlyph tone="bad" label="Failed" compact />);
    expect(screen.getByText("Failed")).toHaveClass("sr-only");
    expect(container.firstElementChild).toHaveAttribute("title", "Failed");
    expect(container.firstElementChild).toHaveAttribute("data-tone", "bad");
  });

  it("colours waiting-on-you in the accent ink and errors in the bad tone, never crimson", () => {
    const { container } = render(
      <>
        <StatusGlyph tone="active" label="Proposed" />
        <StatusGlyph tone="bad" label="Out of service" />
      </>
    );
    expect(container.querySelector('[data-glyph="active"]')).toHaveClass("text-primary-ink");
    expect(container.querySelector('[data-glyph="bad"]')).toHaveClass("text-bad");
    expect(container.innerHTML).not.toContain("brand");
  });
});

describe("Sparkline", () => {
  it("is one labelled image with a bar per day, the last one in the accent ink", () => {
    const { container } = render(<Sparkline values={[0, 2, 1, 4]} label="7 in the last 4 days, 4 today" />);
    expect(screen.getByRole("img", { name: "7 in the last 4 days, 4 today" })).toBeInTheDocument();
    const bars = container.querySelectorAll("rect");
    expect(bars).toHaveLength(4);
    expect(bars[3]).toHaveAttribute("data-last", "true");
    expect(bars[3].getAttribute("class")).toContain("fill-primary-ink");
    // A zero day is a 2px stub, visibly different from a day with counts (min 4px).
    expect(bars[0].getAttribute("height")).toBe("2");
    expect(Number(bars[2].getAttribute("height"))).toBeGreaterThanOrEqual(4);
    expect(Number(bars[3].getAttribute("height"))).toBeGreaterThan(Number(bars[1].getAttribute("height")));
  });

  it("hides the drawing from assistive tech; the sentence is the accessible content", () => {
    const { container } = render(<Sparkline values={[1, 2]} label="3 corrections" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws nothing for an empty series but keeps its sentence", () => {
    const { container } = render(<Sparkline values={[]} label="No tickets in the last 30 days" />);
    expect(screen.getByRole("img", { name: "No tickets in the last 30 days" })).toBeInTheDocument();
    expect(container.querySelectorAll("rect, polyline, circle")).toHaveLength(0);
  });

  it("as a line, marks the last value and the peak", () => {
    const { container } = render(<Sparkline variant="line" values={[1, 5, 2]} label="peak 5" />);
    expect(container.querySelector("polyline")).toBeInTheDocument();
    expect(container.querySelector("circle[data-last]")).toBeInTheDocument();
    expect(container.querySelector("circle[data-peak]")).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders the breadcrumb as a named landmark, the title, lede, facts and actions", () => {
    render(
      <PageHeader
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Keep data fresh" }]}
        title="Inventory"
        lede="Every tool the lab owns."
        facts="101 tools · 86 published"
        actions={<Button variant="default">Add equipment</Button>}
      />
    );
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(within(crumbs).getByText("Keep data fresh")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByText("Every tool the lab owns.")).toBeInTheDocument();
    expect(screen.getByText("101 tools · 86 published")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add equipment" })).toBeInTheDocument();
  });

  it("can be the page's h1, and leaves out a breadcrumb it was not given", () => {
    render(<PageHeader as="h1" title="Your tokens" titleId="tokens-title" />);
    expect(screen.getByRole("heading", { level: 1, name: "Your tokens" })).toHaveAttribute("id", "tokens-title");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("says what is missing and offers the next move", () => {
    render(<EmptyState action={<Button>Clear filters</Button>}>No tools match State: Archived.</EmptyState>);
    expect(screen.getByText("No tools match State: Archived.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });
});
