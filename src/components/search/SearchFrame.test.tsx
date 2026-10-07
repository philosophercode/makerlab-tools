import { act, render, screen } from "../../../test/utils/render";
import { SearchFrame } from "./SearchFrame";
import { FADE_MS, ROTATE_EVERY_MS } from "./use-rotating-line";

/**
 * The minimal search box's placeholder line (student home spec 2026-10-07
 * §6): it fades from one line to the next about every three seconds, holds
 * still while the field has focus or text, and never moves under reduced
 * motion. It is decoration over the field, not the field's label.
 */

const LINES = ["Search 77 tools", "What will you build?", "Find your machine"];

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function line() {
  return document.querySelector('[data-slot="search-line"]');
}

function frame(props: { empty?: boolean; focused?: boolean } = {}) {
  return (
    <SearchFrame lines={LINES} empty={props.empty ?? true} focused={props.focused ?? false}>
      <input aria-label="Search" />
    </SearchFrame>
  );
}

const original = window.matchMedia;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = original;
});

it("fades to the next line about every three seconds, and wraps round", () => {
  mockReducedMotion(false);
  render(frame());
  expect(line()).toHaveTextContent(LINES[0]);
  expect(line()).toHaveAttribute("aria-hidden", "true");

  act(() => vi.advanceTimersByTime(ROTATE_EVERY_MS));
  expect(line()).toHaveClass("opacity-0");
  act(() => vi.advanceTimersByTime(FADE_MS));
  expect(line()).toHaveTextContent(LINES[1]);
  expect(line()).toHaveClass("opacity-100");

  act(() => vi.advanceTimersByTime(2 * ROTATE_EVERY_MS));
  expect(line()).toHaveTextContent(LINES[0]);
});

it("holds still while the field has focus", () => {
  mockReducedMotion(false);
  render(frame({ focused: true }));
  act(() => vi.advanceTimersByTime(3 * ROTATE_EVERY_MS));
  expect(line()).toHaveTextContent(LINES[0]);
  expect(line()).toHaveClass("opacity-100");
});

it("hides the line while the field has text", () => {
  mockReducedMotion(false);
  render(frame({ empty: false }));
  expect(line()).toBeNull();
});

it("shows one static line under reduced motion", () => {
  mockReducedMotion(true);
  render(frame());
  act(() => vi.advanceTimersByTime(5 * ROTATE_EVERY_MS));
  expect(line()).toHaveTextContent(LINES[0]);
  expect(line()).toHaveClass("opacity-100");
  expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
});
