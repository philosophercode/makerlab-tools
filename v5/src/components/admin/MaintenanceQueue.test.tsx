import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { MaintenanceQueueEntry } from "../../lib/data/maintenance";
import { MaintenanceQueue } from "./MaintenanceQueue";

/**
 * The ticket queue's rendering and its one interactive card (spec §5.6, §6).
 *
 * `MaintenanceQueue` is a server component with no `async`, which is what lets
 * it be mounted here; `TicketControls` is the client island inside it, and this
 * file covers both together because the thing worth asserting — a refusal puts
 * the status back — spans the two.
 */

function ticket(overrides: Partial<MaintenanceQueueEntry> = {}): MaintenanceQueueEntry {
  return {
    id: "log-1",
    title: "Laser bed out of focus",
    description: "Cuts are not going through 3 mm ply.",
    resolution: "",
    type: "issue_report",
    priority: "high",
    status: "open",
    toolId: "tool-1",
    toolSlug: "trotec-speedy-400",
    toolName: "Trotec Speedy 400",
    unitId: "unit-1",
    unitLabel: "Trotec // A",
    reportedByName: "Casey Rivera",
    reportedByEmail: "casey@cornell.edu",
    assignedToUserId: null,
    assignedToName: "",
    dateReported: "2026-03-04",
    dateResolved: "",
    createdAt: new Date("2026-03-04T15:00:00.000Z"),
    ...overrides,
  };
}

const STAFF = [{ id: "u-niti", name: "Niti Parikh" }];

function renderQueue(
  tickets: MaintenanceQueueEntry[],
  result: Awaited<ReturnType<Parameters<typeof MaintenanceQueue>[0]["action"]>> = { ok: true }
) {
  const action = vi.fn(async () => result);
  render(<MaintenanceQueue tickets={tickets} staff={STAFF} action={action} />);
  return { action };
}

describe("MaintenanceQueue", () => {
  it("names what is missing when nothing has been filed", () => {
    renderQueue([]);
    // §6: an empty state names what would fill it, not "no results".
    expect(screen.getByText(/No tickets have been filed/)).toBeInTheDocument();
  });

  it("says so when everything filed is already settled", () => {
    renderQueue([ticket({ status: "closed" })]);
    expect(screen.getByText(/Nothing is open/)).toBeInTheDocument();
  });

  it("shows the machine, the reporter and a way to reach them", () => {
    renderQueue([ticket()]);

    // The unit lives on its tool's page — there is no page for a unit alone.
    expect(screen.getByRole("link", { name: "Trotec Speedy 400" })).toHaveAttribute(
      "href",
      "/tools/trotec-speedy-400"
    );
    expect(screen.getByText("Trotec // A")).toBeInTheDocument();
    expect(screen.getByText("Reported by Casey Rivera")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "casey@cornell.edu" })).toHaveAttribute(
      "href",
      "mailto:casey@cornell.edu"
    );
  });

  it("falls back to the snapshot name, and links nowhere, for a ticket with no tool", () => {
    renderQueue([ticket({ toolId: null, toolSlug: null, toolName: "A printer we sold" })]);

    expect(screen.getByText("A printer we sold")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /printer/ })).not.toBeInTheDocument();
  });

  it("keeps settled tickets one click away rather than gone", () => {
    renderQueue([ticket(), ticket({ id: "log-2", title: "Old one", status: "resolved" })]);

    expect(screen.getByText("Show 1 resolved and closed")).toBeInTheDocument();
    // Present in the DOM behind the disclosure: reopening one is legitimate.
    expect(screen.getByText("Old one")).toBeInTheDocument();
  });

  it("saves a status the moment it changes, sending only that field", async () => {
    const { action } = renderQueue([ticket()]);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Status for Laser bed out of focus" }),
      "in_progress"
    );

    expect(action).toHaveBeenCalledWith({
      logId: "log-1",
      // Only the field that changed: a patch carrying all three would overwrite
      // whatever somebody else set from the next bench.
      patch: { status: "in_progress" },
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("sends the assignee's name beside their id, as the snapshot column wants", async () => {
    const { action } = renderQueue([ticket()]);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Assigned to, for Laser bed out of focus" }),
      "u-niti"
    );

    expect(action).toHaveBeenCalledWith({
      logId: "log-1",
      patch: { assignedToUserId: "u-niti", assignedToName: "Niti Parikh" },
    });
  });

  it("restores the previous status when the server refuses, and says why", async () => {
    renderQueue([ticket()], { ok: false, error: "not_permitted" });
    const status = screen.getByRole("combobox", { name: "Status for Laser bed out of focus" });

    await userEvent.selectOptions(status, "closed");

    // Nothing changed on the server, so nothing may claim to have changed here.
    expect(await screen.findByText(/does not hold the permission/)).toBeInTheDocument();
    expect(status).toHaveValue("open");
  });

  it("keeps the new value and warns when only the audit trail failed", async () => {
    renderQueue([ticket()], { ok: true, warning: "audit_unavailable" });
    const status = screen.getByRole("combobox", { name: "Status for Laser bed out of focus" });

    await userEvent.selectOptions(status, "resolved");

    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
    expect(status).toHaveValue("resolved");
  });

  it("only offers to save a resolution once one has been typed", async () => {
    const { action } = renderQueue([ticket()]);
    const save = screen.getByRole("button", { name: "Save resolution" });
    expect(save).toBeDisabled();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Resolution for Laser bed out of focus" }),
      "Refocused."
    );
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(action).toHaveBeenCalledWith({ logId: "log-1", patch: { resolution: "Refocused." } });
  });

  it("leaves a refused resolution in the box, because it is somebody's typing", async () => {
    renderQueue([ticket()], { ok: false, error: "failed" });
    const box = screen.getByRole("textbox", { name: "Resolution for Laser bed out of focus" });

    await userEvent.type(box, "Refocused.");
    await userEvent.click(screen.getByRole("button", { name: "Save resolution" }));

    expect(await screen.findByText(/did not save/)).toBeInTheDocument();
    expect(box).toHaveValue("Refocused.");
  });

  it("disables the assignee control when nobody holds an admin role yet", () => {
    const action = vi.fn(async () => ({ ok: true }) as const);
    render(<MaintenanceQueue tickets={[ticket()]} staff={[]} action={action} />);

    expect(
      screen.getByRole("combobox", { name: "Assigned to, for Laser bed out of focus" })
    ).toBeDisabled();
  });

  it("shows the ticket the queue is ordered by first", () => {
    renderQueue([ticket(), ticket({ id: "log-2", title: "Second" })]);

    const [first] = screen.getAllByRole("listitem");
    expect(within(first).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Laser bed out of focus"
    );
  });
});
