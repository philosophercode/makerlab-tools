import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { AsyncButton } from "./AsyncButton";

/** A one-shot action's states, inside the button (DESIGN.md §8.10). */

it("keeps both labels in one cell, so the width cannot change between them", () => {
  render(
    <AsyncButton onRun={async () => true} doneLabel="Done">
      Looks good
    </AsyncButton>
  );
  const button = screen.getByRole("button", { name: "Looks good" });
  expect(button).toHaveTextContent("Looks good");
  expect(button).toHaveTextContent("Done");
  expect(button).toHaveAttribute("data-state", "idle");
});

it("shows a sentence it is given as the reason, on an alert line", async () => {
  render(
    <AsyncButton onRun={async () => "Nothing was re-read."} doneLabel="Done">
      Re-process
    </AsyncButton>
  );
  await userEvent.click(screen.getByRole("button", { name: "Re-process" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was re-read.");
});

it("goes quietly back to idle when the caller reports the failure itself", async () => {
  const onRun = vi.fn(async () => false as const);
  render(
    <AsyncButton onRun={onRun} doneLabel="Done">
      Looks good
    </AsyncButton>
  );
  await userEvent.click(screen.getByRole("button", { name: "Looks good" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Looks good" })).toHaveAttribute("data-state", "idle"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onRun).toHaveBeenCalledTimes(1);
});

it("treats a thrown error like a failure reported elsewhere, and never says Done", async () => {
  render(
    <AsyncButton onRun={async () => Promise.reject(new Error("offline"))} doneLabel="Done">
      Looks good
    </AsyncButton>
  );
  await userEvent.click(screen.getByRole("button", { name: "Looks good" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Looks good" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
});
