import { render, screen, userEvent } from "../../../test/utils/render";
import { RefreshDialog } from "./RefreshDialog";

/** **Refresh research (N)** (refresh research spec §5.1, §6). */

it("sends the tools, descriptions off by default, and a note for one tool", async () => {
  const action = vi.fn(async () => ({ ok: true as const, queued: 1, skipped: 0, missing: 0 }));
  const onQueued = vi.fn();
  render(<RefreshDialog toolIds={["t1"]} action={action} onClose={vi.fn()} onQueued={onQueued} />);
  expect(screen.getByRole("checkbox", { name: "Also propose description rewrites" })).not.toBeChecked();
  await userEvent.type(screen.getByLabelText("Note for research (one tool only)"), "the 80 W model");
  await userEvent.click(screen.getByRole("button", { name: "Refresh 1" }));
  expect(action).toHaveBeenCalledWith({ toolIds: ["t1"], includeDescription: false, note: "the 80 W model" });
  expect(await screen.findByText("Refreshing 1 tool — results appear on the Refresh page.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the Refresh page" })).toHaveAttribute("href", "/admin/refresh");
  expect(onQueued).toHaveBeenCalled();
});

it("offers no note for several tools, and says how many were skipped", async () => {
  const action = vi.fn(async () => ({ ok: true as const, queued: 1, skipped: 2, missing: 0 }));
  render(<RefreshDialog toolIds={["a", "b", "c"]} action={action} onClose={vi.fn()} />);
  expect(screen.queryByLabelText("Note for research (one tool only)")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "Also propose description rewrites" }));
  await userEvent.click(screen.getByRole("button", { name: "Refresh 3" }));
  expect(action).toHaveBeenCalledWith({ toolIds: ["a", "b", "c"], includeDescription: true, note: null });
  expect(await screen.findByText("2 already had a refresh open and were skipped.")).toBeInTheDocument();
});

it("says the day's limit with what is left", async () => {
  const action = vi.fn(async () => ({ ok: false as const, error: "daily_limit" as const, remaining: 4 }));
  render(<RefreshDialog toolIds={["a"]} action={action} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Refresh 1" }));
  expect(await screen.findByText("That would pass today's research limit. 4 left today.")).toBeInTheDocument();
});

it("will not send more than one press may", () => {
  render(<RefreshDialog toolIds={Array.from({ length: 26 }, (_, n) => `t${n}`)} action={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Refresh 26" })).toBeDisabled();
  expect(screen.getByText("Refresh at most 25 tools at a time.")).toBeInTheDocument();
});
