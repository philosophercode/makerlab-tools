import { render, screen, userEvent } from "../../../test/utils/render";
import { LogCompletedForm, type LogCompletedTool } from "./LogCompletedForm";

/**
 * **Log completed maintenance** on `/admin/maintenance` (assistant–GUI parity
 * spec §11 answer 5): opens inline, offers the chosen tool's units, sends what
 * was typed, says a refusal and keeps the typing, closes on a landed log.
 */

const TOOLS: LogCompletedTool[] = [
  { id: "t-wen", name: "WEN Bandsaw", units: [{ id: "u-1", label: "WEN #1" }] },
  { id: "t-form", name: "Form 4", units: [] },
];

async function openAndFill() {
  await userEvent.click(screen.getByRole("button", { name: "Log completed maintenance" }));
  await userEvent.selectOptions(screen.getByLabelText("Tool"), "t-wen");
  await userEvent.selectOptions(screen.getByLabelText("Unit"), "u-1");
  await userEvent.type(screen.getByLabelText("What was done, in a line"), "Replaced the belt");
  await userEvent.type(screen.getByLabelText("Details"), "New belt, tension set.");
}

it("sends the tool, unit, words and kind, then closes and says it was logged", async () => {
  const action = vi.fn(async () => ({ ok: true as const, logId: "log-1" }));
  render(<LogCompletedForm tools={TOOLS} action={action} />);
  await openAndFill();
  await userEvent.click(screen.getByRole("button", { name: "Log it" }));
  expect(action).toHaveBeenCalledWith({ tool: "t-wen", unitId: "u-1", title: "Replaced the belt", resolution: "New belt, tension set.", type: "repair" });
  expect(await screen.findByText("Logged. It is in the resolved list below.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Log completed maintenance" })).toBeInTheDocument();
});

it("says why a log was refused and keeps what was typed", async () => {
  const action = vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const }));
  render(<LogCompletedForm tools={TOOLS} action={action} />);
  await openAndFill();
  await userEvent.click(screen.getByRole("button", { name: "Log it" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("does not hold the permission");
  expect(screen.getByLabelText("What was done, in a line")).toHaveValue("Replaced the belt");
});

it("asks for the tool before sending anything", async () => {
  const action = vi.fn();
  render(<LogCompletedForm tools={TOOLS} action={action} />);
  await userEvent.click(screen.getByRole("button", { name: "Log completed maintenance" }));
  await userEvent.click(screen.getByRole("button", { name: "Log it" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose the tool.");
  expect(action).not.toHaveBeenCalled();
});

it("offers no units for a tool without any, and Escape closes the form", async () => {
  render(<LogCompletedForm tools={TOOLS} action={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Log completed maintenance" }));
  await userEvent.selectOptions(screen.getByLabelText("Tool"), "t-form");
  expect(screen.getByLabelText("Unit")).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Log completed maintenance" })).toHaveFocus();
});
