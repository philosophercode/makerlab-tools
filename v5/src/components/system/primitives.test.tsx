import { render, screen } from "../../../test/utils/render";
import { Sparkline } from "./Sparkline";
import { StatusGlyph } from "./StatusGlyph";
import { Tile } from "./Tile";

/**
 * The small primitives (UI system spec §6): status is never colour alone, a
 * sparkline says in words what it draws, and a tile never shows an unreadable
 * count as zero.
 */

it("StatusGlyph pairs a shape with a word, and keeps the word for screen readers when compact", () => {
  const { rerender } = render(<StatusGlyph tone="bad" label="Failed" />);
  expect(screen.getByText("Failed")).toBeVisible();
  expect(screen.getByText("■")).toHaveAttribute("aria-hidden", "true");

  rerender(<StatusGlyph tone="ok" label="Published" compact />);
  expect(screen.getByText("Published")).toHaveClass("sr-only");
});

it("Sparkline is one labelled image with a bar per day, the last one in the accent", () => {
  const { container } = render(<Sparkline values={[0, 2, 1, 4]} label="7 in the last 4 days" />);
  expect(screen.getByRole("img", { name: "7 in the last 4 days" })).toBeInTheDocument();
  const bars = container.querySelectorAll("rect");
  expect(bars).toHaveLength(4);
  expect(bars[3].getAttribute("class")).toContain("fill-primary-ink");
});

it("Tile says a count could not be read instead of showing zero", () => {
  render(<Tile href="/admin/maintenance" icon={null} title="Maintenance" value={null} unit="open tickets" note="Could not be read" />);
  const tile = screen.getByRole("link", { name: /Maintenance/ });
  expect(tile).toHaveTextContent("Could not be read");
  expect(tile).not.toHaveTextContent("0");
});

it("Tile shows the headline count, what it counts, and its facts", () => {
  render(
    <Tile
      href="/admin/intake"
      icon={null}
      title="Intake"
      value={2}
      unit="researched, waiting for you"
      attention
      facts={[{ label: "Research failed", value: 1, tone: "bad" }]}
    />
  );
  const tile = screen.getByRole("link", { name: /Intake/ });
  expect(tile).toHaveAttribute("href", "/admin/intake");
  expect(tile).toHaveTextContent("2researched, waiting for you");
  expect(tile).toHaveTextContent("Research failed1");
});
