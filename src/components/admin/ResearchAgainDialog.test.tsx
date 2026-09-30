import { render, screen, userEvent } from "../../../test/utils/render";
import { REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import { ResearchAgainDialog, type ResearchAgainDialogProps } from "./ResearchAgainDialog";

/**
 * "Anything to focus on?" — the panel **Research again** opens (amendment
 * "Guided redo (focus + guidance)"): focus chips where Everything and a field
 * exclude each other, suggestions that write into the note, the note's cap,
 * and a Cancel that sends nothing.
 */

function renderDialog(over: Partial<ResearchAgainDialogProps> = {}) {
  const props: ResearchAgainDialogProps = {
    initialNote: "",
    imageAvailable: true,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<ResearchAgainDialog {...props} />);
  return props;
}

const chip = (name: string) => screen.getByRole("button", { name });
const box = () => screen.getByLabelText("Note for research (optional)");

describe("ResearchAgainDialog — focus", () => {
  it("starts on Everything and sends no focus for it", async () => {
    const props = renderDialog();
    expect(screen.getByRole("heading", { name: "Anything to focus on?" })).toBeInTheDocument();
    expect(chip("Everything")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Description", "Specs", "Links & manuals", "Image"]) {
      expect(chip(name)).toHaveAttribute("aria-pressed", "false");
    }
    await userEvent.click(chip("Research"));
    expect(props.onSubmit).toHaveBeenCalledWith({ focus: null, note: null });
  });

  it("lets go of Everything when a field is picked, and takes several fields in order", async () => {
    const props = renderDialog();
    await userEvent.click(chip("Image"));
    await userEvent.click(chip("Specs"));
    expect(chip("Everything")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Image")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip("Research"));
    expect(props.onSubmit).toHaveBeenCalledWith({ focus: ["specs", "image"], note: null });
  });

  it("goes back to Everything when it is pressed, or when the last field is let go", async () => {
    const props = renderDialog();
    await userEvent.click(chip("Description"));
    await userEvent.click(chip("Description"));
    expect(chip("Everything")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(chip("Specs"));
    await userEvent.click(chip("Everything"));
    expect(chip("Specs")).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip("Research"));
    expect(props.onSubmit).toHaveBeenCalledWith({ focus: null, note: null });
  });

  it("offers no Image when the item has its own photo", () => {
    renderDialog({ imageAvailable: false });
    expect(chip("Image")).toBeDisabled();
  });
});

describe("ResearchAgainDialog — suggestions and the note", () => {
  it("starts with the last note, and a suggestion appends after it as a new sentence", async () => {
    const props = renderDialog({ initialNote: "The name is right" });
    expect(box()).toHaveValue("The name is right");
    await userEvent.click(chip("Beef up the specs from the spec table or manual"));
    expect(box()).toHaveValue("The name is right. Beef up the specs from the spec table or manual");
    await userEvent.click(chip("Shorter, clearer description"));
    expect(box()).toHaveValue(
      "The name is right. Beef up the specs from the spec table or manual. Shorter, clearer description"
    );
    await userEvent.click(chip("Research"));
    expect(props.onSubmit).toHaveBeenCalledWith({
      focus: null,
      note: "The name is right. Beef up the specs from the spec table or manual. Shorter, clearer description",
    });
  });

  it("leaves the variant suggestion open for the reviewer to finish", async () => {
    const props = renderDialog();
    await userEvent.click(chip("Wrong model or variant — it's …"));
    expect(box()).toHaveValue("Wrong model or variant — it's ");
    expect(box()).toHaveFocus();
    // Typed where the cursor was left, without clicking into the box first.
    await userEvent.keyboard("the X2D Combo");
    await userEvent.click(chip("Research"));
    expect(props.onSubmit).toHaveBeenCalledWith({ focus: null, note: "Wrong model or variant — it's the X2D Combo" });
  });

  it(`caps the note at ${REVIEWER_NOTE_MAX_CHARS} characters, suggestions included, and counts it`, async () => {
    renderDialog({ initialNote: "y".repeat(REVIEWER_NOTE_MAX_CHARS - 5) });
    expect(box()).toHaveAttribute("maxLength", String(REVIEWER_NOTE_MAX_CHARS));
    await userEvent.click(chip("Find the official manual"));
    expect((box() as HTMLTextAreaElement).value).toHaveLength(REVIEWER_NOTE_MAX_CHARS);
    expect(screen.getByText(`${REVIEWER_NOTE_MAX_CHARS}/${REVIEWER_NOTE_MAX_CHARS}`)).toBeInTheDocument();
  });

  it("sends a note typed over several lines as one paragraph", async () => {
    const props = renderDialog();
    await userEvent.type(box(), "Specs are thin.{Enter}{Enter}Use the spec table.");
    await userEvent.click(chip("Specs"));
    await userEvent.click(chip("Research"));
    expect(props.onSubmit).toHaveBeenCalledWith({ focus: ["specs"], note: "Specs are thin. Use the spec table." });
  });

  it("Cancel and Escape close it without sending anything", async () => {
    const props = renderDialog();
    await userEvent.click(chip("Cancel"));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.type(box(), "{Escape}");
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
