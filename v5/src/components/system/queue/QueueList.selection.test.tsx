import { useEffect } from "react";
import { act, render, screen, userEvent } from "../../../../test/utils/render";
import { ChatLauncherProvider, useChatLauncher } from "../../ChatLauncherContext";
import { PageSelectionProvider, usePageSelectionReader, usePublishSelection, type PageSelection } from "../../chat/page-selection";
import { QueueList } from "./QueueList";

/**
 * Selection for the assistant (assistant–GUI parity spec §3.6): a queue's
 * ticked cards are published as ids for the chat to send, a bar offers **Ask
 * the assistant about these**, and nothing is published by a queue that is
 * not selectable or once the page is gone.
 */

interface Ticket {
  id: string;
  title: string;
}

const TICKETS: Ticket[] = [
  { id: "a", title: "Belt slipping" },
  { id: "b", title: "Fan noisy" },
];

/** Reads what the chat would send, as the chat does: on demand. */
let read: () => PageSelection | null = () => null;
function Reader() {
  const reader = usePageSelectionReader();
  useEffect(() => {
    read = reader;
  }, [reader]);
  return null;
}

let isOpen = false;
function OpenState() {
  const launcher = useChatLauncher();
  useEffect(() => {
    isOpen = launcher.isOpen;
  });
  return null;
}

function Queue({ selectable = true }: { selectable?: boolean }) {
  return (
    <QueueList
      items={TICKETS}
      getId={(ticket) => ticket.id}
      isOpen={() => true}
      renderItem={(ticket) => <article aria-label={ticket.title}>{ticket.title}</article>}
      selectable={selectable ? { kind: "maintenance_log", name: (ticket) => ticket.title } : undefined}
      labels={{ list: "Tickets", filters: "Filters", settled: (n) => `${n} settled`, empty: "None", emptyOpen: "None open" }}
    />
  );
}

function renderWithChat(ui: React.ReactNode) {
  return render(
    <ChatLauncherProvider>
      <PageSelectionProvider>
        <Reader />
        <OpenState />
        {ui}
      </PageSelectionProvider>
    </ChatLauncherProvider>
  );
}

it("publishes the ticked ids and offers to ask the assistant about them", async () => {
  renderWithChat(<Queue />);
  expect(read()).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Select “Fan noisy”" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Select “Belt slipping”" }));
  expect(read()).toEqual({ kind: "maintenance_log", ids: ["a", "b"] });
  expect(screen.getByRole("status")).toHaveTextContent("2 selected");

  await userEvent.click(screen.getByRole("button", { name: "Ask the assistant about these" }));
  expect(isOpen).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(read()).toBeNull();
});

it("draws no checkboxes and publishes nothing when the queue is not selectable", () => {
  renderWithChat(<Queue selectable={false} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(read()).toBeNull();
});

it("forgets the selection when the page's island unmounts", async () => {
  const view = renderWithChat(<Queue />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Select “Fan noisy”" }));
  expect(read()).toEqual({ kind: "maintenance_log", ids: ["b"] });
  act(() => view.rerender(
    <ChatLauncherProvider>
      <PageSelectionProvider>
        <Reader />
      </PageSelectionProvider>
    </ChatLauncherProvider>
  ));
  expect(read()).toBeNull();
});

it("does not let an empty publisher wipe another island's selection", () => {
  function Publisher({ ids }: { ids: string[] }) {
    usePublishSelection("tool", ids);
    return null;
  }
  render(
    <PageSelectionProvider>
      <Reader />
      <Publisher ids={["t1"]} />
      <Publisher ids={[]} />
    </PageSelectionProvider>
  );
  expect(read()).toEqual({ kind: "tool", ids: ["t1"] });
});

it("works without a selection provider (a component test of a queue alone)", async () => {
  render(<Queue />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Select “Fan noisy”" }));
  expect(screen.getByRole("status")).toHaveTextContent("1 selected");
});

it("tells the chat only about ticked rows the current filter still shows, and never ticks settled work", async () => {
  const items: (Ticket & { done?: boolean })[] = [...TICKETS, { id: "c", title: "Old jam", done: true }];
  renderWithChat(
    <QueueList
      items={items}
      getId={(ticket) => ticket.id}
      isOpen={(ticket) => !ticket.done}
      searchText={(ticket) => ticket.title}
      renderItem={(ticket) => <article aria-label={ticket.title}>{ticket.title}</article>}
      selectable={{ kind: "maintenance_log", name: (ticket) => ticket.title }}
      labels={{ list: "Tickets", filters: "Filters", settled: (n) => `${n} settled`, empty: "None", emptyOpen: "None open" }}
    />
  );
  expect(screen.queryByRole("checkbox", { name: "Select “Old jam”" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "Select “Fan noisy”" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Select “Belt slipping”" }));
  expect(read()).toEqual({ kind: "maintenance_log", ids: ["a", "b"] });

  await userEvent.type(screen.getByRole("searchbox"), "fan");
  expect(read()).toEqual({ kind: "maintenance_log", ids: ["b"] });
  expect(screen.getByText("1 selected")).toBeInTheDocument();

  await userEvent.clear(screen.getByRole("searchbox"));
  expect(read()).toEqual({ kind: "maintenance_log", ids: ["a", "b"] });
});
