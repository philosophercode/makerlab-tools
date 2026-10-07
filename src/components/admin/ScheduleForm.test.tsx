import { render, screen, userEvent } from "../../../test/utils/render";
import { ScheduleForm, type ScheduleFormResult, type ScheduleToolOption } from "./ScheduleForm";

/**
 * The recurring-task form (recurring maintenance spec §6, §13 Q4): general
 * upkeep by default, "each unit" chosen for a tool with several units, today
 * as the first due date, and the checks it can say better than the server.
 */

const TOOLS: ScheduleToolOption[] = [
  { id: "t-laser", name: "Trotec Speedy 400", units: [{ id: "u-a", label: "Laser A" }, { id: "u-b", label: "Laser B" }] },
  { id: "t-cutter", name: "Box cutter", units: [] },
];

const TODAY = "2026-10-06";

function renderForm(submit = vi.fn(async (): Promise<ScheduleFormResult> => ({ ok: true, created: 1, unaudited: false }))) {
  const onSaved = vi.fn();
  render(<ScheduleForm tools={TOOLS} today={TODAY} submit={submit} onCancel={vi.fn()} onSaved={onSaved} />);
  return { submit, onSaved };
}

it("sends general lab upkeep, weekly from today, when only a title is given", async () => {
  const { submit, onSaved } = renderForm();
  await userEvent.type(screen.getByLabelText("Task"), "Wipe down workbenches");
  await userEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(submit).toHaveBeenCalledWith({
    title: "Wipe down workbenches",
    instructions: "",
    toolId: null,
    unitId: null,
    eachUnit: false,
    intervalCount: 1,
    intervalUnit: "week",
    dueOn: TODAY,
  });
  expect(onSaved).toHaveBeenCalledWith({ created: 1, unaudited: false });
});

it("chooses each unit by default for a tool with several units (spec §13 Q4)", async () => {
  const { submit } = renderForm();
  await userEvent.type(screen.getByLabelText("Task"), "Clean the lens");
  await userEvent.selectOptions(screen.getByLabelText("Tool"), "t-laser");
  expect(screen.getByLabelText("Unit")).toHaveValue("each");
  await userEvent.clear(screen.getByLabelText("Repeat every"));
  await userEvent.type(screen.getByLabelText("Repeat every"), "2");
  await userEvent.selectOptions(screen.getByLabelText("Days, weeks or months"), "month");
  await userEvent.type(screen.getByLabelText("How to do it (optional)"), "Lens wipes only.");
  await userEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ toolId: "t-laser", unitId: null, eachUnit: true, intervalCount: 2, intervalUnit: "month", instructions: "Lens wipes only." })
  );
});

it("asks for a title and a sensible interval before sending anything", async () => {
  const { submit } = renderForm();
  await userEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Give the task a name.");
  await userEvent.type(screen.getByLabelText("Task"), "Empty the dust collector");
  await userEvent.clear(screen.getByLabelText("Repeat every"));
  await userEvent.type(screen.getByLabelText("Repeat every"), "0");
  await userEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Repeat every 1 to 730");
  expect(submit).not.toHaveBeenCalled();
});

it("says a refusal and keeps what was typed", async () => {
  const { submit } = renderForm(vi.fn(async (): Promise<ScheduleFormResult> => ({ ok: false, error: "not_permitted" })));
  await userEvent.type(screen.getByLabelText("Task"), "Empty the dust collector");
  await userEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(submit).toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent("does not hold the permission");
  expect(screen.getByLabelText("Task")).toHaveValue("Empty the dust collector");
});

it("edits with the task's values and offers no 'each unit'", async () => {
  const submit = vi.fn(async () => ({ ok: true as const, unaudited: false }));
  render(
    <ScheduleForm
      tools={TOOLS}
      today={TODAY}
      initial={{ title: "Clean the lens", instructions: "", toolId: "t-laser", unitId: "u-b", intervalCount: 1, intervalUnit: "week", dueOn: "2026-10-01" }}
      submit={submit}
      onCancel={vi.fn()}
      onSaved={vi.fn()}
    />
  );
  expect(screen.getByLabelText("Unit")).toHaveValue("u-b");
  expect(screen.queryByRole("option", { name: /Each unit/ })).toBeNull();
  // A past date is allowed (it shows as overdue) and the hint says so.
  expect(screen.getByText(/This date has passed/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ unitId: "u-b", eachUnit: false, dueOn: "2026-10-01" }));
});
