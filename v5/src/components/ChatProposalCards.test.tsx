const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { render, screen, userEvent, within } from "../../test/utils/render";
import type { FieldProposal } from "../lib/refresh/types";
import { ChatProposalCards, type ChatProposalItem } from "./ChatProposalCards";

/**
 * The assistant's proposal cards (refresh research spec §12.2, §12.5
 * "Component"): verified and unverified, Accept and Reject through the route,
 * a conflict, and Accept all verified.
 */

function item(id: string, overrides: Partial<FieldProposal> = {}): ChatProposalItem {
  return {
    kind: "proposal",
    proposalId: id,
    subject: { kind: "tool", id: "t1", name: "Form 4" },
    proposal: {
      id: "use_restrictions",
      field: "use_restrictions",
      kind: "new",
      safety: true,
      current: null,
      proposed: "Trained users only.",
      citations: [{ quote: "Trained users only", url: "https://formlabs.example/form4", verified: true }],
      decision: "pending",
      ...overrides,
    },
  };
}

beforeEach(() => router.refresh.mockClear());

it("accepts through the route, shows the card accepted, and refreshes the page behind", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/chat-proposals", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ results: [{ id: "p1", status: "accepted", proposal: { ...item("p1").proposal, decision: "accepted" } }] });
    })
  );
  render(<ChatProposalCards items={[item("p1")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText("Accepted")).toBeInTheDocument();
  expect(bodies).toEqual([{ ids: ["p1"], decision: "accept" }]);
  expect(router.refresh).toHaveBeenCalled();
});

it("shows a conflict with the record's value now", async () => {
  server.use(
    http.post("*/api/chat-proposals", () =>
      HttpResponse.json({ results: [{ id: "p1", status: "conflict", proposal: { ...item("p1").proposal, decision: "conflict", current: "Edited this afternoon." } }] })
    )
  );
  render(<ChatProposalCards items={[item("p1")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByText("Changed since — decide again")).toBeInTheDocument();
  expect(screen.getByText("Edited this afternoon.")).toBeInTheDocument();
});

it("offers Accept all verified for several, skipping one whose quote was not found", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("*/api/chat-proposals", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ results: [] });
    })
  );
  render(
    <ChatProposalCards
      items={[
        item("p1"),
        item("p2", { id: "emergency_stop", field: "emergency_stop" }),
        item("p3", { id: "description", field: "description", safety: false, citations: [{ quote: "x", url: "https://a.example/", verified: false }] }),
      ]}
    />
  );
  expect(within(screen.getByRole("article", { name: "Description" })).getByRole("button", { name: "Accept" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Accept all verified" }));
  expect(bodies).toEqual([{ ids: ["p1", "p2"], decision: "accept" }]);
});

it("says a refusal", async () => {
  server.use(http.post("*/api/chat-proposals", () => HttpResponse.json({ results: [{ id: "p1", status: "refused", error: "expired" }] })));
  render(<ChatProposalCards items={[item("p1")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/more than a week old/);
});
