import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { DueItem } from "../../lib/data/maintenance-schedules";
import { DueTasks } from "./DueTasks";

/**
 * **Recurring tasks due** on `/admin/maintenance` (recurring maintenance spec
 * §6, amendment 2026-10-06): the overdue tone and words, the three empty
 * states, and **Done** with and without a note.
 */

const TODAY = "2026-10-06";

function item(overrides: Partial<DueItem> = {}): DueItem {
  return {
    id: "s-1",
    title: "Clean the laser lens",
    instructions: "Lens wipes only, never paper towels.",
    toolId: "t-1",
    toolName: "Trotec Speedy 400",
    toolSlug: "trotec",
    toolArchived: false,
    unitId: null,
    unitLabel: null,
    interval: { count: 1, unit: "week" },
    nextDueOn: "2026-10-03",
    lastDoneOn: "2026-09-26",
    status: "active",
    recent: [],
    state: "overdue",
    overdueDays: 3,
    ...overrides,
  };
}

const HREF = "/admin/maintenance/schedules";

it("says how late an overdue task is, in the bad tone, with where and how often", () => {
  render(<DueTasks items={[item()]} today={TODAY} hasSchedules action={vi.fn()} schedulesHref={HREF} />);
  const card = screen.getByRole("article", { name: "Clean the laser lens" });
  expect(card).toHaveAttribute("data-tone", "safety");
  expect(within(card).getByText("3 days overdue")).toBeInTheDocument();
  expect(within(card).getByRole("link", { name: "Trotec Speedy 400" })).toHaveAttribute("href", "/tools/trotec");
  expect(within(card).getByText("Every week")).toBeInTheDocument();
  expect(within(card).getByText("Lens wipes only, never paper towels.")).toBeInTheDocument();
});

it("names general lab upkeep and a task due today", () => {
  render(
    <DueTasks
      items={[item({ id: "s-2", title: "Wipe down workbenches", toolId: null, toolName: null, toolSlug: null, nextDueOn: TODAY, state: "today", overdueDays: 0, interval: { count: 1, unit: "day" } })]}
      today={TODAY}
      hasSchedules
      action={vi.fn()}
      schedulesHref={HREF}
    />
  );
  const card = screen.getByRole("article", { name: "Wipe down workbenches" });
  expect(within(card).getByText("General lab upkeep")).toBeInTheDocument();
  expect(within(card).getByText("Due today")).toBeInTheDocument();
  expect(within(card).getByText("Every day")).toBeInTheDocument();
});

it("offers to set tasks up when there are none, and says when nothing is due", () => {
  const { unmount } = render(<DueTasks items={[]} today={TODAY} hasSchedules={false} action={vi.fn()} schedulesHref={HREF} />);
  expect(screen.getByText(/No recurring tasks yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set up recurring tasks" })).toHaveAttribute("href", HREF);
  unmount();

  render(<DueTasks items={[]} today={TODAY} hasSchedules action={vi.fn()} schedulesHref={HREF} />);
  expect(screen.getByText("Nothing is due in the next 7 days.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Manage recurring tasks" })).toHaveAttribute("href", HREF);
});

it("checks a task off in one click and says when it is next due", async () => {
  const action = vi.fn(async () => ({ ok: true as const, nextDueOn: "2026-10-13" }));
  render(<DueTasks items={[item()]} today={TODAY} hasSchedules action={action} schedulesHref={HREF} />);
  await userEvent.click(screen.getByRole("button", { name: "Mark Clean the laser lens done" }));
  expect(action).toHaveBeenCalledWith({ scheduleId: "s-1", note: "", expectedDueOn: "2026-10-03" });
  expect(await screen.findByText("Done: Clean the laser lens. Next due 2026-10-13.")).toBeInTheDocument();
});

it("sends a note with Done, and keeps it when the check-off is refused", async () => {
  const action = vi.fn(async () => ({ ok: false as const, error: "conflict" as const }));
  render(<DueTasks items={[item()]} today={TODAY} hasSchedules action={action} schedulesHref={HREF} />);
  await userEvent.click(screen.getByRole("button", { name: "Add a note" }));
  await userEvent.type(screen.getByLabelText("Note for Clean the laser lens"), "Lens was smoky.");
  await userEvent.click(screen.getByRole("button", { name: "Mark Clean the laser lens done" }));
  expect(action).toHaveBeenCalledWith({ scheduleId: "s-1", note: "Lens was smoky.", expectedDueOn: "2026-10-03" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Somebody else changed this");
  expect(screen.getByLabelText("Note for Clean the laser lens")).toHaveValue("Lens was smoky.");
});
