import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { FeedbackQueueEntry } from "../../lib/data/feedback";
import { CorrectionsQueue } from "./CorrectionsQueue";

/**
 * The corrections queue and its buttons (spec §5.6, §6).
 *
 * The promise under test is the brief's: an accepted correction is **one click
 * from the field it corrects**. That click is the tool's own page, where the
 * field is shown and where the editor opens for anybody holding `tools.edit`.
 */

function correction(overrides: Partial<FeedbackQueueEntry> = {}): FeedbackQueueEntry {
  return {
    id: "fb-1",
    toolId: "tool-1",
    toolSlug: "form-4",
    toolName: "Form 4",
    fieldFlagged: "materials",
    issueDescription: "The resin list is missing Rigid 10K.",
    suggestedFix: "Add Rigid 10K.",
    reporterName: "Ada Lovelace",
    reporterEmail: "ada@cornell.edu",
    status: "new",
    createdAt: new Date("2026-03-04T15:00:00.000Z"),
    ...overrides,
  };
}

function renderQueue(
  corrections: FeedbackQueueEntry[],
  result: Awaited<ReturnType<Parameters<typeof CorrectionsQueue>[0]["action"]>> = { ok: true }
) {
  const action = vi.fn(async () => result);
  render(<CorrectionsQueue corrections={corrections} action={action} />);
  return { action };
}

describe("CorrectionsQueue", () => {
  it("names what is missing when nothing has been reported", () => {
    renderQueue([]);
    expect(screen.getByText(/No corrections have been reported/)).toBeInTheDocument();
  });

  it("says so when everything reported has been handled", () => {
    renderQueue([correction({ status: "fixed" })]);
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
  });

  it("is one click from the field it corrects", () => {
    renderQueue([correction()]);

    expect(screen.getByRole("link", { name: "Form 4" })).toHaveAttribute("href", "/tools/form-4");
    // And says which field, so the reviewer knows where to look on that page.
    expect(screen.getByText("Materials")).toBeInTheDocument();
  });

  it("says so rather than linking plausibly when no tool matched", () => {
    renderQueue([correction({ toolId: null, toolSlug: null, toolName: "" })]);

    expect(screen.getAllByText("No tool matched").length).toBeGreaterThan(0);
    // The reporter's address is still a link; the tool is not, because there
    // is no page to send the reviewer to.
    expect(screen.queryByRole("link", { name: /Form 4/ })).not.toBeInTheDocument();
  });

  it("shows what was reported and what was suggested, plus a way to ask", () => {
    renderQueue([correction()]);

    expect(screen.getByText("The resin list is missing Rigid 10K.")).toBeInTheDocument();
    expect(screen.getByText(/Add Rigid 10K\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ada@cornell.edu" })).toHaveAttribute(
      "href",
      "mailto:ada@cornell.edu"
    );
  });

  it("offers one button per outcome, leaving out the status it already has", () => {
    renderQueue([correction({ status: "reviewed" })]);

    // `<details>` is also a group, so this one is asked for by name.
    const group = screen.getByRole("group", { name: /correction about Form 4/ });
    expect(within(group).getByRole("button", { name: "Mark fixed" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    // A button that would do nothing is not a button.
    expect(within(group).queryByRole("button", { name: "Mark reviewed" })).not.toBeInTheDocument();
  });

  it("marks a correction fixed in one click", async () => {
    const { action } = renderQueue([correction()]);

    await userEvent.click(screen.getByRole("button", { name: "Mark fixed" }));

    expect(action).toHaveBeenCalledWith({ feedbackId: "fb-1", status: "fixed" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("restores the previous status when the server refuses, and says why", async () => {
    renderQueue([correction()], { ok: false, error: "not_permitted" });

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await screen.findByText(/does not hold the permission/)).toBeInTheDocument();
    // Back to Waiting, so the buttons on offer are the ones for a new report.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("keeps handled corrections behind a disclosure rather than dropping them", () => {
    renderQueue([correction(), correction({ id: "fb-2", status: "dismissed" })]);

    expect(screen.getByText("Show 1 already handled")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
