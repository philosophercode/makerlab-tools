const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { ActionProposalCardPayload } from "../../lib/capabilities/actions";
import { ActionProposalCard } from "./ActionProposalCard";

/**
 * The action card (assistant–GUI parity spec §6, §10 "Component"): drawn from
 * the stored preview, Confirm sends ids only, a batch confirms what stays
 * ticked, each row shows its own outcome, and Enter never confirms.
 */

function payload(overrides: Partial<ActionProposalCardPayload> = {}): ActionProposalCardPayload {
  return {
    kind: "action-proposal",
    groupId: "g1",
    actionId: "people.set_role",
    risk: "people",
    items: [
      {
        id: "p1",
        subjectId: "u-luis",
        preview: {
          summary: { key: "people_set_role", values: { name: "Luis" } },
          rows: [{ field: "role", before: "user", after: "admin", format: "role" }],
          subjectName: "Luis",
          link: "/admin/users",
        },
        expiresAt: "2026-09-27T13:00:00.000Z",
      },
    ],
    refused: [],
    ...overrides,
  };
}

function ticketBatch(): ActionProposalCardPayload {
  const item = (id: string, title: string) => ({
    id,
    subjectId: `t-${id}`,
    preview: {
      summary: { key: "tickets_update", values: { title, tool: "WEN" } },
      rows: [{ field: "status", before: "open", after: "resolved", format: "ticketStatus" as const }],
      subjectName: title,
      link: "/admin/maintenance",
    },
    expiresAt: "2026-09-27T13:00:00.000Z",
  });
  return payload({ actionId: "tickets.update", risk: "operational", items: [item("p1", "Belt slipping"), item("p2", "Fan noisy")] });
}

beforeEach(() => router.refresh.mockClear());

it("shows the stored summary and before → after, in words, and waits for a click", () => {
  render(<ActionProposalCard payload={payload()} />);
  const card = screen.getByRole("article", { name: "Change Luis's role" });
  expect(card).toHaveTextContent("Role");
  expect(card).toHaveTextContent("User");
  expect(card).toHaveTextContent("Admin");
  expect(card).toHaveTextContent("People");
  expect(card).toHaveTextContent("Waiting for you");
  expect(screen.getByText("Nothing changes until you press Confirm.")).toBeInTheDocument();
});

it("confirms by id only, shows Done with a link, and refreshes the page behind", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/action-proposals", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ results: [{ id: "p1", status: "confirmed", link: "/admin/users" }] });
    })
  );
  render(<ActionProposalCard payload={payload()} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Done")).toBeInTheDocument();
  expect(bodies).toEqual([{ ids: ["p1"], decision: "confirm" }]);
  expect(screen.getByRole("link", { name: "Open the page" })).toHaveAttribute("href", "/admin/users");
  expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
});

it("confirms only the rows still ticked in a batch, and shows each row's outcome", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/action-proposals", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ results: [{ id: "p2", status: "failed", error: "not_found" }] });
    })
  );
  render(<ActionProposalCard payload={ticketBatch()} />);
  expect(screen.getByRole("button", { name: "Confirm 2" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: "Include “Belt slipping”" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm 1" }));
  expect(bodies).toEqual([{ ids: ["p2"], decision: "confirm" }]);
  const fan = screen.getByRole("article", { name: "Update the ticket “Fan noisy” (WEN)" });
  expect(await within(fan).findByText(/Not done: That no longer exists/)).toBeInTheDocument();
  // The unticked row is still open, still confirmable.
  expect(within(screen.getByRole("article", { name: "Update the ticket “Belt slipping” (WEN)" })).getByText("Waiting for you")).toBeInTheDocument();
});

it("dismisses without confirming", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/action-proposals", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ results: [{ id: "p1", status: "cancelled" }] });
    })
  );
  render(<ActionProposalCard payload={payload()} />);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(await screen.findByText("Dismissed")).toBeInTheDocument();
  expect(bodies).toEqual([{ ids: ["p1"], decision: "cancel" }]);
});

it("says an expired card changed nothing", async () => {
  server.use(http.post("*/api/action-proposals", () => HttpResponse.json({ results: [{ id: "p1", status: "expired" }] })));
  render(<ActionProposalCard payload={payload()} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(/expired before it was confirmed, so nothing changed/)).toBeInTheDocument();
});

it("keeps the card open and says so when the request itself fails", async () => {
  server.use(http.post("*/api/action-proposals", () => HttpResponse.json({ code: "failed" }, { status: 500 })));
  render(<ActionProposalCard payload={payload()} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was changed");
  expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
});

it("never confirms on Enter: the buttons are not a form's submit", async () => {
  const posted = vi.fn();
  server.use(
    http.post("*/api/action-proposals", () => {
      posted();
      return HttpResponse.json({ results: [] });
    })
  );
  render(<ActionProposalCard payload={payload()} />);
  expect(screen.getByRole("button", { name: "Confirm" })).toHaveAttribute("type", "button");
  await userEvent.keyboard("{Enter}");
  expect(posted).not.toHaveBeenCalled();
});

it("lists items that could not be proposed, with the reason", () => {
  render(<ActionProposalCard payload={payload({ refused: [{ subjectId: "ghost", error: "unknown_user" }] })} />);
  expect(screen.getByText(/1 more was not proposed: That account no longer exists/)).toBeInTheDocument();
});
