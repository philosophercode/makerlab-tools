const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/admin/inventory/lab-notes" }));

import { render, screen, userEvent } from "../../../../test/utils/render";
import { LAB_NOTES_MAX_CHARS } from "../../../lib/lab-notes/setting";
import { LabNotesForm } from "./LabNotesForm";

/** The lab-wide notes' form (identity spec amendment "Lab notes"). */

beforeEach(() => refresh.mockClear());

it("shows the stored notes and counts them the way the assistant reads them", () => {
  render(<LabNotesForm initial={"- Clean your station.\n\nPut tools back."} save={vi.fn()} />);

  expect(screen.getByLabelText("Lab-wide notes")).toHaveValue("- Clean your station.\n\nPut tools back.");
  expect(screen.getByText(/^2 notes · 38 of 4,?000 characters$/)).toBeInTheDocument();
});

it("saves the whole text through its action, and says Saved", async () => {
  const save = vi.fn(async () => ({ ok: true as const }));
  render(<LabNotesForm initial="" save={save} />);

  await userEvent.type(screen.getByLabelText("Lab-wide notes"), "Clean your station before you leave.");
  await userEvent.click(screen.getByRole("button", { name: "Save lab-wide notes" }));

  expect(save).toHaveBeenCalledWith({ text: "Clean your station before you leave." });
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();
});

it("shows a refusal from the server", async () => {
  const save = vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const }));
  render(<LabNotesForm initial="Clean up." save={save} />);

  await userEvent.click(screen.getByRole("button", { name: "Save lab-wide notes" }));
  expect(await screen.findByText(/not permitted|permission/i)).toBeInTheDocument();
});

it("will not send text over the cap, and says so in the count", async () => {
  const save = vi.fn();
  render(<LabNotesForm initial={"x".repeat(LAB_NOTES_MAX_CHARS + 1)} save={save} />);

  expect(screen.getByLabelText("Lab-wide notes")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save lab-wide notes" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});
