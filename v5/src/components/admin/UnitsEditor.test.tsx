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
  const { rerender } = render(<UnitsEditor units={units} pending={false} {...handlers} />);
  /** What the panel does after a save or a conflict reload: new rows, same keys. */
  const reload = (next: UnitRecord[]) =>
    rerender(<UnitsEditor units={next} pending={false} {...handlers} />);
  return { ...handlers, reload };
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
  await userEvent.type(fields.getByLabelText("Asset tag"), "CT-9");
  await userEvent.click(fields.getByRole("button", { name: "Save unit" }));

  // Only what they changed: a patch carrying every field would post this row's
  // whole copy over anything the panel has not seen (the `ToolFieldsForm` rule).
  expect(handlers.onEdit).toHaveBeenCalledWith("unit-1", {
    serialNumber: "FL-0042",
    assetTag: "CT-9",
  });
});

it("has nothing to save until something changes", () => {
  renderEditor([unit()]);
  expect(row("Form 4 #1").getByRole("button", { name: "Save unit" })).toBeDisabled();
});

/**
 * The regression, and the expensive one.
 *
 * These rows are keyed by unit id, so a re-read replaces `units` without
 * remounting them: the row goes on holding whatever it opened with. Somebody
 * else fills in the serial number, this panel hits a conflict, the person
 * clicks Reload — and then saves a date. Under the old rule that save also
 * carried this row's ten-minute-old empty serial, the fresh token accepted it,
 * and the transcribed serial was gone with no conflict and no audit event.
 */
it("does not post a stale value over somebody else's edit after a reload", async () => {
  const handlers = renderEditor([unit()]);

  await userEvent.type(row("Form 4 #1").getByLabelText("Acquired"), "2026-03-04");

  // Somebody else filled the serial in; the panel re-read and handed it down.
  handlers.reload([unit({ serialNumber: "F4-0192" })]);

  const fields = row("Form 4 #1");
  // The box the person never touched now shows the other person's value…
  expect(fields.getByLabelText("Serial number")).toHaveValue("F4-0192");
  // …and the one they were typing in is still theirs.
  expect(fields.getByLabelText("Acquired")).toHaveValue("2026-03-04");

  await userEvent.click(fields.getByRole("button", { name: "Save unit" }));
  expect(handlers.onEdit).toHaveBeenCalledWith("unit-1", { dateAcquired: "2026-03-04" });
});

it("never rewrites notes, which this section has no box for", async () => {
  const handlers = renderEditor([unit({ notes: "Tank replaced 2026-02" })]);
  const fields = row("Form 4 #1");

  await userEvent.type(fields.getByLabelText("Serial number"), "FL-0042");
  await userEvent.click(fields.getByRole("button", { name: "Save unit" }));

  expect(Object.keys(vi.mocked(handlers.onEdit).mock.calls[0][1])).toEqual(["serialNumber"]);
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
