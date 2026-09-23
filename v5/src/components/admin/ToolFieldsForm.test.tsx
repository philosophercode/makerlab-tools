import { render, screen, userEvent } from "../../../test/utils/render";
import { ToolFieldsForm } from "./ToolFieldsForm";
import type { EditableTool } from "../../lib/data/tools";

/**
 * The tool's own fields (spec §5.3(3)).
 *
 * The property that matters is the patch: **only what this person changed**.
 * A form that posted every field would overwrite somebody else's edit with a
 * value it read before they made it — a silent overwrite arriving through the
 * one path the revision check cannot see, because the save itself is legitimate.
 */

function tool(overrides: Partial<EditableTool> = {}): EditableTool {
  return {
    id: "tool-1",
    slug: "form-4",
    name: "Form 4",
    description: "A resin printer",
    categoryId: null,
    locationId: null,
    materials: ["Standard resin"],
    ppeRequired: [],
    tags: [],
    trainingRequired: false,
    useRestrictions: null,
    emergencyStop: null,
    notes: null,
    starterQuestions: [],
    revision: "1758000000.1",
    published: true,
    archivedAt: null,
    lastReviewedAt: null,
    lastReviewedBy: null,
    ...overrides,
  };
}

function renderForm(overrides: Partial<React.ComponentProps<typeof ToolFieldsForm>> = {}) {
  const onSave = vi.fn();
  render(
    <ToolFieldsForm
      values={tool()}
      categories={[{ id: "cat-1", name: "Resin Printing", group: "3D Printing" }]}
      locations={[{ id: "loc-1", room: "Bloomberg 061", zone: "Resin Bay", mapTag: null }]}
      pending={false}
      onSave={onSave}
      {...overrides}
    />
  );
  return { onSave };
}

async function save() {
  await userEvent.click(screen.getByRole("button", { name: "Save details" }));
}

it("shows the values the tool currently holds", () => {
  renderForm();
  expect(screen.getByLabelText("Name")).toHaveValue("Form 4");
  expect(screen.getByLabelText("Materials")).toHaveValue("Standard resin");
});

it("sends an empty patch when nothing was touched, which is a touch", async () => {
  // Deliberate: `updateTool` treats it as a touch, which moves the revision and
  // tells anybody else's open panel that this one was here. Refusing to save
  // would make the button do nothing visible.
  const { onSave } = renderForm();
  await save();
  expect(onSave).toHaveBeenCalledWith({});
});

it("sends only the field that changed", async () => {
  const { onSave } = renderForm();

  await userEvent.type(screen.getByLabelText("Notes"), "Tank replaced");
  await save();

  expect(onSave).toHaveBeenCalledWith({ notes: "Tank replaced" });
});

it("splits a list field on commas and drops the blanks", async () => {
  const { onSave } = renderForm();

  await userEvent.clear(screen.getByLabelText("Materials"));
  await userEvent.type(screen.getByLabelText("Materials"), "Clear resin, , Tough 2000");
  await save();

  expect(onSave).toHaveBeenCalledWith({ materials: ["Clear resin", "Tough 2000"] });
});

it("sends null rather than an empty string when a select is cleared", async () => {
  const { onSave } = renderForm({ values: tool({ categoryId: "cat-1" }) });

  await userEvent.selectOptions(screen.getByLabelText("Category"), "");
  await save();

  // The catalogue derives "not recorded" from null; "" would be an answer.
  expect(onSave).toHaveBeenCalledWith({ categoryId: null });
});

it("keeps the field labels clean when the other version is showing", () => {
  renderForm({ theirs: tool({ description: "Their rewrite" }) });

  // The conflict note sits beside the box, not inside the label — otherwise a
  // screen reader would read the field as "Description Their version: …".
  expect(screen.getByLabelText("Description")).toHaveValue("A resin printer");
  expect(screen.getByText("Their version: Their rewrite")).toBeInTheDocument();
});

it("shows nothing beside the fields the other person did not touch", () => {
  renderForm({ theirs: tool({ description: "Their rewrite" }) });
  expect(screen.getAllByText(/^Their version:/)).toHaveLength(1);
});

describe('assistant starter questions (amendment "Tool-specific starter questions")', () => {
  it("shows three boxes, holding the tool's questions and blanks for the rest", () => {
    renderForm({ values: tool({ starterQuestions: ["What resins can I print with?"] }) });
    expect(screen.getByRole("group", { name: "Assistant starter questions" })).toBeInTheDocument();
    expect(screen.getByLabelText("Starter question 1")).toHaveValue("What resins can I print with?");
    expect(screen.getByLabelText("Starter question 2")).toHaveValue("");
    expect(screen.getByLabelText("Starter question 3")).toHaveValue("");
    expect(screen.getByLabelText("Starter question 1")).toHaveAttribute("maxLength", "80");
  });

  it("sends only the questions when they change, blanks dropped", async () => {
    const { onSave } = renderForm({ values: tool({ starterQuestions: ["What resins can I print with?"] }) });
    await userEvent.type(screen.getByLabelText("Starter question 3"), "How big can a part be?");
    await save();
    expect(onSave).toHaveBeenCalledWith({
      starterQuestions: ["What resins can I print with?", "How big can a part be?"],
    });
  });

  it("sends an empty list when every box is cleared — the generic chips", async () => {
    const { onSave } = renderForm({ values: tool({ starterQuestions: ["What resins can I print with?"] }) });
    await userEvent.clear(screen.getByLabelText("Starter question 1"));
    await save();
    expect(onSave).toHaveBeenCalledWith({ starterQuestions: [] });
  });

  it("does not send them when nobody touched them", async () => {
    const { onSave } = renderForm({ values: tool({ starterQuestions: ["What resins can I print with?"] }) });
    await userEvent.type(screen.getByLabelText("Notes"), "Tank replaced");
    await save();
    expect(onSave).toHaveBeenCalledWith({ notes: "Tank replaced" });
  });

  it("shows the other person's questions after a conflict, and takes them", async () => {
    const { onSave } = renderForm({
      values: tool({ starterQuestions: ["Mine?"] }),
      theirs: tool({ starterQuestions: ["Theirs one?", "Theirs two?"] }),
    });
    expect(screen.getByText("Their version: Theirs one? · Theirs two?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use theirs" }));
    expect(screen.getByLabelText("Starter question 2")).toHaveValue("Theirs two?");
    await save();
    expect(onSave).toHaveBeenCalledWith({ starterQuestions: ["Theirs one?", "Theirs two?"] });
  });
});
