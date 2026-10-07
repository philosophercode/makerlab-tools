const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import type { TriageProposal, TriageTool } from "../../lib/actions/manual-triage";
import { ManualTriage } from "./ManualTriage";

/**
 * The Manuals view (amendment 2026-10-07 "manual triage"): rows grouped by
 * tool with before → after, a tool's rows confirmed in one request, keys that
 * work only inside the view, focus moving to the next undecided tool, and a
 * progress line.
 */

const FUTURE = "2099-01-01T00:00:00.000Z";

function proposal(over: Partial<TriageProposal> & Pick<TriageProposal, "id">): TriageProposal {
  return {
    actionId: "resources.add",
    changes: ["add_manual"],
    resourceId: null,
    before: null,
    after: { title: "Form 4 user manual", type: "Manual", url: "https://formlabs.com/form-4-manual.pdf", hidden: false },
    changed: ["title", "type", "url"],
    stale: [],
    missing: false,
    openUrl: "https://formlabs.com/form-4-manual.pdf",
    openIsPdf: true,
    host: "formlabs.com",
    pages: null,
    expiresAt: FUTURE,
    summary: { key: "resources_add", values: { tool: "Form 4", title: "Form 4 user manual" } },
    ...over,
  };
}

const FORM: TriageTool = {
  toolId: "t-form",
  name: "Form 4",
  link: "/tools/form-4",
  photo: null,
  documents: [{ id: "r1", title: "form4 manual", type: "Link", url: "https://formlabs.com/form4.pdf", host: "formlabs.com", hidden: false, pages: 212 }],
  proposals: [
    proposal({ id: "a1" }),
    proposal({
      id: "a2",
      actionId: "resources.edit",
      changes: ["retype"],
      resourceId: "r1",
      before: { title: "form4 manual", type: "Link", url: "https://formlabs.com/form4.pdf", hidden: false },
      after: { title: "form4 manual", type: "Manual", url: "https://formlabs.com/form4.pdf", hidden: false },
      changed: ["type"],
      openUrl: "https://formlabs.com/form4.pdf",
      pages: 212,
    }),
  ],
};

const TROTEC: TriageTool = {
  toolId: "t-trotec",
  name: "Speedy 400",
  link: "/tools/speedy-400",
  photo: null,
  documents: [],
  proposals: [
    proposal({
      id: "b1",
      actionId: "resources.edit",
      changes: ["hide"],
      resourceId: "r9",
      before: { title: "Old brochure", type: "Link", url: "https://trotec.com/brochure", hidden: false },
      after: { title: "Old brochure", type: "Link", url: "https://trotec.com/brochure", hidden: true },
      changed: ["hidden"],
      openUrl: "https://trotec.com/brochure",
      openIsPdf: false,
      host: "trotec.com",
    }),
  ],
};

/** Records each request, and answers every id with `answer` (default: done as asked). */
function recordRequests(answer?: (id: string, decision: string) => { status: string; error?: string }) {
  const bodies: { ids: string[]; decision: string }[] = [];
  server.use(
    http.post("*/api/action-proposals", async ({ request }) => {
      const body = (await request.json()) as { ids: string[]; decision: string };
      bodies.push(body);
      return HttpResponse.json({
        results: body.ids.map((id) => ({ id, ...(answer ? answer(id, body.decision) : { status: body.decision === "confirm" ? "confirmed" : "cancelled" }) })),
      });
    })
  );
  return bodies;
}

const region = (name: RegExp) => screen.getByRole("region", { name });

beforeEach(() => {
  router.refresh.mockClear();
});

it("groups the rows by tool, with the tool's documents, the change's label and before → after", () => {
  render(<ManualTriage tools={[FORM, TROTEC]} />);
  expect(screen.getByText("0 of 2 tools decided")).toBeInTheDocument();
  const form = region(/Form 4/);
  expect(within(form).getByText("form4 manual", { selector: "span" })).toBeInTheDocument();
  expect(within(form).getAllByText("212 pages").length).toBeGreaterThan(0);

  const add = within(form).getByRole("listitem", { name: "Add manual" });
  expect(within(add).getByText("A new document")).toBeInTheDocument();
  expect(within(add).getByRole("link", { name: /Open PDF/ })).toHaveAttribute("href", "https://formlabs.com/form-4-manual.pdf");
  expect(within(add).getByRole("link", { name: /Open PDF/ })).toHaveAttribute("target", "_blank");

  const retype = within(form).getByRole("listitem", { name: "Retype" });
  const table = within(retype).getByRole("table");
  expect(within(table).getByRole("rowheader", { name: "Before" }).closest("tr")).toHaveTextContent("Link");
  expect(within(table).getByRole("rowheader", { name: "After" }).closest("tr")).toHaveTextContent("Manual (changed)");

  expect(within(region(/Speedy 400/)).getByRole("listitem", { name: "Hide" })).toHaveTextContent("Hidden");
  expect(within(region(/Speedy 400/)).getByRole("link", { name: /Open link/ })).toBeInTheDocument();
});

it("puts focus on the first tool when the view opens", () => {
  render(<ManualTriage tools={[FORM, TROTEC]} />);
  expect(region(/Form 4/)).toHaveFocus();
});

it("confirms a tool's rows in one request, then moves focus to the next undecided tool", async () => {
  const bodies = recordRequests();
  render(<ManualTriage tools={[FORM, TROTEC]} />);
  await userEvent.click(within(region(/Form 4/)).getByRole("button", { name: "Confirm all 2 for this tool" }));

  expect(bodies).toEqual([{ ids: ["a1", "a2"], decision: "confirm" }]);
  expect(await screen.findByText("1 of 2 tools decided")).toBeInTheDocument();
  expect(within(region(/Form 4/)).getAllByText("Confirmed")).toHaveLength(2);
  await waitFor(() => expect(region(/Speedy 400/)).toHaveFocus());
  expect(router.refresh).toHaveBeenCalled();
});

it("holds a row's Confirm while the tool has other open rows, then sends the chosen ones together", async () => {
  const bodies = recordRequests();
  render(<ManualTriage tools={[FORM, TROTEC]} />);
  const form = region(/Form 4/);
  await userEvent.click(within(within(form).getByRole("listitem", { name: "Retype" })).getByRole("button", { name: "Confirm" }));
  // Nothing sent yet: the row is chosen, with Undo.
  expect(bodies).toEqual([]);
  const retype = within(form).getByRole("listitem", { name: "Retype" });
  expect(within(retype).getByText("Chosen")).toBeInTheDocument();
  expect(within(retype).getByRole("button", { name: "Undo" })).toBeInTheDocument();

  // Dismissing the last open row sends the dismissal, then the chosen row.
  await userEvent.click(within(within(form).getByRole("listitem", { name: "Add manual" })).getByRole("button", { name: "Dismiss" }));
  await waitFor(() =>
    expect(bodies).toEqual([
      { ids: ["a1"], decision: "cancel" },
      { ids: ["a2"], decision: "confirm" },
    ])
  );
  expect(await within(form).findByText("Confirmed")).toBeInTheDocument();
  expect(within(form).getByText("Dismissed")).toBeInTheDocument();
});

it("sends a row's Confirm at once when it is the tool's only open row", async () => {
  const bodies = recordRequests();
  render(<ManualTriage tools={[FORM, TROTEC]} />);
  await userEvent.click(within(region(/Speedy 400/)).getByRole("button", { name: "Confirm" }));
  expect(bodies).toEqual([{ ids: ["b1"], decision: "confirm" }]);
});

it("Undo puts a chosen row back", async () => {
  recordRequests();
  render(<ManualTriage tools={[FORM]} />);
  const retype = () => within(region(/Form 4/)).getByRole("listitem", { name: "Retype" });
  await userEvent.click(within(retype()).getByRole("button", { name: "Confirm" }));
  await userEvent.click(within(retype()).getByRole("button", { name: "Undo" }));
  expect(within(retype()).getByText("Waiting")).toBeInTheDocument();
});

describe("keys", () => {
  it("j and k move between tools; y confirms and n dismisses the tool in focus", async () => {
    const bodies = recordRequests();
    render(<ManualTriage tools={[FORM, TROTEC]} />);
    await userEvent.keyboard("j");
    expect(region(/Speedy 400/)).toHaveFocus();
    await userEvent.keyboard("k");
    expect(region(/Form 4/)).toHaveFocus();

    await userEvent.keyboard("y");
    await waitFor(() => expect(bodies).toEqual([{ ids: ["a1", "a2"], decision: "confirm" }]));
    await waitFor(() => expect(region(/Speedy 400/)).toHaveFocus());

    await userEvent.keyboard("n");
    await waitFor(() => expect(bodies[1]).toEqual({ ids: ["b1"], decision: "cancel" }));
    expect(await screen.findByText("2 of 2 tools decided")).toBeInTheDocument();
    expect(await screen.findByText("Every tool is decided.")).toBeInTheDocument();
  });

  it("o opens the focused row's PDF in a new tab, with no opener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ManualTriage tools={[FORM, TROTEC]} />);
    await userEvent.keyboard("o");
    expect(open).toHaveBeenCalledWith("https://formlabs.com/form-4-manual.pdf", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("? lists the keys in a dialog, and keys typed there do nothing behind it", async () => {
    const bodies = recordRequests();
    render(<ManualTriage tools={[FORM, TROTEC]} />);
    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("Next tool");
    expect(dialog).toHaveTextContent("Confirm this tool's open changes");
    await userEvent.keyboard("y");
    expect(bodies).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does nothing with Ctrl, Cmd or Alt held, and Tab still leaves the view", async () => {
    const bodies = recordRequests();
    render(
      <>
        <ManualTriage tools={[TROTEC]} />
        <button type="button">After the view</button>
      </>
    );
    await userEvent.keyboard("{Control>}y{/Control}{Meta>}y{/Meta}{Alt>}n{/Alt}");
    expect(bodies).toEqual([]);
    for (let i = 0; i < 12 && document.activeElement?.textContent !== "After the view"; i += 1) await userEvent.tab();
    expect(screen.getByRole("button", { name: "After the view" })).toHaveFocus();
  });
});

it("shows a conflict on the row, and puts rows back when the request fails", async () => {
  recordRequests((id) => (id === "a2" ? { status: "conflict", error: "conflict" } : { status: "confirmed" }));
  const { unmount } = render(<ManualTriage tools={[FORM]} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm all 2 for this tool" }));
  expect(await screen.findByText(/The tool changed since this was proposed/)).toBeInTheDocument();
  unmount();

  server.use(http.post("*/api/action-proposals", () => HttpResponse.json({ code: "failed" }, { status: 500 })));
  render(<ManualTriage tools={[TROTEC]} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("That did not reach the server. Nothing changed. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
});

it("says so when there is nothing to triage", () => {
  render(<ManualTriage tools={[]} />);
  expect(screen.getByText("No manual or link changes are waiting.")).toBeInTheDocument();
});
