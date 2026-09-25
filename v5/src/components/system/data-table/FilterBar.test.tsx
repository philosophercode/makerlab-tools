import { render, screen, userEvent, within } from "../../../../test/utils/render";
import { FilterBar } from "./FilterBar";
import { FacetFilter } from "./FacetFilter";

/**
 * The filter bar (UI system spec §7.2; DESIGN.md §8.4): a labelled search, the
 * count as a live status, Clear only while something narrows the list, and a
 * facet menu that shows counts and names its chosen value.
 */

it("labels the search, says the count, and offers Clear only when asked", async () => {
  const onSearch = vi.fn();
  const { rerender } = render(
    <FilterBar label="Filter things" search={{ value: "", onChange: onSearch, label: "Search" }} shown={2} total={5} />
  );
  expect(screen.getByRole("search", { name: "Filter things" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 5");
  expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

  await userEvent.type(screen.getByRole("searchbox", { name: "Search" }), "a");
  expect(onSearch).toHaveBeenCalledWith("a");

  const onClear = vi.fn();
  rerender(<FilterBar label="Filter things" shown={2} total={5} onClear={onClear} />);
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(onClear).toHaveBeenCalled();
});

it("a facet lists values with their counts, disables the empty ones, and reports the choice", async () => {
  const onChange = vi.fn();
  render(
    <FacetFilter
      label="Status"
      value={null}
      options={[
        { value: "open", label: "Open", count: 4 },
        { value: "closed", label: "Closed", count: 0 },
      ]}
      onChange={onChange}
    />
  );
  await userEvent.click(screen.getByRole("button", { name: "Status" }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByRole("menuitemradio", { name: /Any/ })).toHaveAttribute("aria-checked", "true");
  expect(within(menu).getByRole("menuitemradio", { name: /Open/ })).toHaveTextContent("4");
  expect(within(menu).getByRole("menuitemradio", { name: /Closed/ })).toHaveAttribute("aria-disabled", "true");

  await userEvent.click(within(menu).getByRole("menuitemradio", { name: /Open/ }));
  expect(onChange).toHaveBeenCalledWith("open");
});

it("a chosen facet names its value on the button", () => {
  render(<FacetFilter label="Status" value="open" options={[{ value: "open", label: "Open", count: 4 }]} onChange={() => {}} />);
  expect(screen.getByRole("button", { name: "Status: Open" })).toHaveTextContent("Open");
});
