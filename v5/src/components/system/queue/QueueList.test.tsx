import { render, screen, userEvent, within } from "../../../../test/utils/render";
import { QueueList, type QueueListProps } from "./QueueList";

/**
 * The shared queue layout (UI system phase 4): open work on the page, settled
 * work behind a disclosure, and a filter bar over both whose facets count what
 * each value would leave — and an emptied list that names the filter.
 */

interface Ticket {
  id: string;
  title: string;
  status: "open" | "closed";
  priority: "high" | "low";
}

const TICKETS: Ticket[] = [
  { id: "1", title: "Laser out of focus", status: "open", priority: "high" },
  { id: "2", title: "Printer clogged", status: "open", priority: "low" },
  { id: "3", title: "Old belt", status: "closed", priority: "low" },
];

function renderQueue(items: Ticket[] = TICKETS, overrides: Partial<QueueListProps<Ticket>> = {}) {
  return render(
    <QueueList
      items={items}
      getId={(ticket) => ticket.id}
      isOpen={(ticket) => ticket.status === "open"}
      renderItem={(ticket) => <article aria-label={ticket.title}>{ticket.title}</article>}
      searchText={(ticket) => ticket.title}
      facets={[
        {
          id: "priority",
          label: "Priority",
          values: ["high", "low"],
          valueLabel: (value) => (value === "high" ? "High" : "Low"),
          matches: (ticket, value) => ticket.priority === value,
        },
      ]}
      labels={{
        list: "Open tickets",
        filters: "Filter the tickets",
        search: "Search tickets",
        settled: (count) => `Show ${count} closed`,
        empty: "No tickets have been filed.",
        emptyOpen: "Nothing is open.",
      }}
      {...overrides}
    />
  );
}

it("puts open work on the page and settled work behind a disclosure", () => {
  renderQueue();
  const open = screen.getByRole("list", { name: "Open tickets" });
  expect(within(open).getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual([
    "Laser out of focus",
    "Printer clogged",
  ]);
  const summary = screen.getByText("Show 1 closed");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(within(summary.closest("details") as HTMLElement).getByRole("article", { name: "Old belt" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 3 of 3");
});

it("says what is missing when there is nothing at all, with no filter bar", () => {
  renderQueue([]);
  expect(screen.getByText("No tickets have been filed.")).toBeInTheDocument();
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
});

it("says nothing is open when everything is settled", () => {
  renderQueue([TICKETS[2]]);
  expect(screen.getByText("Nothing is open.")).toBeInTheDocument();
  expect(screen.getByText("Show 1 closed")).toBeInTheDocument();
});

it("narrows both halves as you search", async () => {
  const user = userEvent.setup();
  renderQueue();
  await user.type(screen.getByRole("searchbox", { name: "Search tickets" }), "belt");
  expect(screen.queryByRole("list", { name: "Open tickets" })).not.toBeInTheDocument();
  expect(screen.getByText(/Nothing here matches “belt”/)).toBeInTheDocument();
  expect(screen.getByText("Show 1 closed")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 3");
});

it("counts each facet value given the search, and names the facet that emptied the list", async () => {
  const user = userEvent.setup();
  renderQueue();
  await user.type(screen.getByRole("searchbox", { name: "Search tickets" }), "o");
  await user.click(screen.getByRole("button", { name: "Priority" }));
  // "o" leaves all three: one high, two low.
  expect(screen.getByRole("menuitemradio", { name: /High/ })).toHaveTextContent("1");
  expect(screen.getByRole("menuitemradio", { name: /Low/ })).toHaveTextContent("2");
  await user.click(screen.getByRole("menuitemradio", { name: /High/ }));
  expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual(["Laser out of focus"]);

  await user.clear(screen.getByRole("searchbox", { name: "Search tickets" }));
  await user.type(screen.getByRole("searchbox", { name: "Search tickets" }), "belt");
  expect(screen.getByText(/Nothing here matches “belt” · Priority: High/)).toBeInTheDocument();

  await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
  expect(screen.getByRole("status")).toHaveTextContent("Showing 3 of 3");
});

it("lets the caller lay out a run of cards (intake's batches)", () => {
  renderQueue(TICKETS, {
    renderList: (items, part) => (
      <section aria-label={`${part} run`}>
        {items.map((ticket) => (
          <p key={ticket.id}>{ticket.title}</p>
        ))}
      </section>
    ),
  });
  expect(within(screen.getByRole("region", { name: "open run" })).getAllByText(/./)).toHaveLength(2);
});
