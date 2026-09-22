import { render, screen, userEvent, within } from "../../../test/utils/render";
import { UnitsEditor } from "./UnitsEditor";
import type { UnitRecord } from "../../lib/data/units";

/**
 * The Units section (spec §5.3(3), §4.5).
 *
 * The section a SuperMaker uses standing next to the machine, so the two things
 * checked hardest are that a status change costs one gesture and that **retire
 * is always offered beside delete** — a unit with maintenance history cannot be
 * deleted, and the control that does work has to be on screen.
 */

function unit(overrides: Partial<UnitRecord> = {}): UnitRecord {
  return {
    id: "unit-1",
    unitLabel: "Form 4 #1",
    serialNumber: null,
    assetTag: null,
    status: "available",
    condition: null,
    dateAcquired: null,
    notes: null,
    ...overrides,
  };
}

function renderEditor(units: UnitRecord[] = []) {
  const handlers = {
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onRetire: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<UnitsEditor units={units} pending={false} {...handlers} />);
  return handlers;
}

function row(label: string) {
  return within(screen.getByRole("listitem", { name: label }));
}

it("names what is missing when a tool has no units (§6, States)", () => {
  renderEditor();
  expect(screen.getByText(/No units recorded/)).toBeInTheDocument();
});

it("adds a unit by its label and clears the box", async () => {
  const handlers = renderEditor();

  await userEvent.type(screen.getByLabelText("New unit"), "Form 4 #2");
  await userEvent.click(screen.getByRole("button", { name: "Add unit" }));

  expect(handlers.onAdd).toHaveBeenCalledWith("Form 4 #2");
  expect(screen.getByLabelText("New unit")).toHaveValue("");
});

it("will not add a unit with no label", async () => {
  const handlers = renderEditor();
  expect(screen.getByRole("button", { name: "Add unit" })).toBeDisabled();
  expect(handlers.onAdd).not.toHaveBeenCalled();
});

it("saves a status change immediately — one decision, one gesture", async () => {
  const handlers = renderEditor([unit()]);

  await userEvent.selectOptions(row("Form 4 #1").getByLabelText("Status"), "out_of_service");

  expect(handlers.onEdit).toHaveBeenCalledWith("unit-1", { status: "out_of_service" });
});

it("offers 'not known' as a condition, because it is the honest one", async () => {
  const handlers = renderEditor([unit({ condition: "good" })]);

  await userEvent.selectOptions(row("Form 4 #1").getByLabelText("Condition"), "");

  expect(handlers.onEdit).toHaveBeenCalledWith("unit-1", { condition: null });
});

it("saves the transcribed fields together, when the person is done typing", async () => {
  const handlers = renderEditor([unit()]);
  const fields = row("Form 4 #1");

  await userEvent.type(fields.getByLabelText("Serial number"), "FL-0042");
  await userEvent.click(fields.getByRole("button", { name: "Save unit" }));

  expect(handlers.onEdit).toHaveBeenCalledWith("unit-1", {
    unitLabel: "Form 4 #1",
    serialNumber: "FL-0042",
    assetTag: "",
    dateAcquired: "",
    notes: "",
  });
});

it("offers retire beside delete, because delete usually refuses", async () => {
  const handlers = renderEditor([unit()]);
  const fields = row("Form 4 #1");

  expect(fields.getByRole("button", { name: "Retire" })).toBeEnabled();
  await userEvent.click(fields.getByRole("button", { name: "Delete" }));
  expect(handlers.onDelete).toHaveBeenCalledWith("unit-1");
});

it("does not offer to retire a unit that is already retired", () => {
  renderEditor([unit({ status: "retired" })]);
  expect(row("Form 4 #1").getByRole("button", { name: "Retire" })).toBeDisabled();
});
