import { render, screen, userEvent } from "../../../test/utils/render";
import type { FieldProposal } from "../../lib/refresh/types";
import { ProposalCard } from "./ProposalCard";

/**
 * The proposal card (refresh research spec §6, §12.5): every kind, the safety
 * chip, a verified quote, a quote not found (greyed, no one-click accept), a
 * conflict, and decided cards.
 */

function proposal(overrides: Partial<FieldProposal> = {}): FieldProposal {
  return {
    id: "use_restrictions",
    field: "use_restrictions",
    kind: "differs",
    safety: true,
    current: "Rated for 1-micron filtration.",
    proposed: "Filters particles down to 5 microns.",
    citations: [{ quote: "Filters particles down to 5 microns", url: "https://wenproducts.com/dc3401", verified: true }],
    decision: "pending",
    ...overrides,
  };
}

it("shows the field, now → proposed, the kind and safety chips, and the quote with its link", async () => {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  render(<ProposalCard proposal={proposal()} onAccept={onAccept} onReject={onReject} />);
  const card = screen.getByRole("article", { name: "Use restrictions" });
  expect(card).toHaveTextContent("Differs");
  expect(card).toHaveTextContent("Safety");
  expect(card).toHaveTextContent("Rated for 1-micron filtration.");
  expect(card).toHaveTextContent("Filters particles down to 5 microns.");
  expect(screen.getByRole("link", { name: "wenproducts.com" })).toHaveAttribute("href", "https://wenproducts.com/dc3401");
  expect(screen.queryByText("Quote not found on the page")).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(onAccept).toHaveBeenCalledTimes(1);
  expect(onReject).toHaveBeenCalledTimes(1);
});

it("says the lab's rules are kept on a restrictions card that adds a line (amendment 2026-09-24)", () => {
  render(
    <ProposalCard
      proposal={proposal({
        current: "Resin handling training required before first print.",
        proposed: "Resin handling training required before first print.\nYoung or inexperienced users must be supervised.",
        added: ["Young or inexperienced users must be supervised."],
      })}
    />
  );
  expect(screen.getByText("The lab's rules are kept. Adds: Young or inexperienced users must be supervised.")).toBeInTheDocument();
});

it("greys a proposal whose quote was not found, and offers no one-click accept", () => {
  render(
    <ProposalCard
      proposal={proposal({ citations: [{ quote: "invented", url: "https://wenproducts.com/dc3401", verified: false }] })}
      onAccept={vi.fn()}
      onReject={vi.fn()}
    />
  );
  expect(screen.getByText("Quote not found on the page")).toBeInTheDocument();
  expect(screen.getByText(/cannot be accepted here/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
});

it("renders a new list with what it adds, and an empty current value as (empty)", () => {
  render(<ProposalCard proposal={proposal({ field: "tags", id: "tags", kind: "new", safety: false, current: [], proposed: ["FDM", "Enclosed"], added: ["FDM", "Enclosed"] })} />);
  const card = screen.getByRole("article", { name: "Tags" });
  expect(card).toHaveTextContent("New");
  expect(card).not.toHaveTextContent("Safety");
  expect(card).toHaveTextContent("(empty)");
  expect(card).toHaveTextContent("Adds: FDM, Enclosed");
});

it("renders a resource as its title and host, with no quote needed", () => {
  render(
    <ProposalCard
      proposal={proposal({
        id: "resource:https://wenproducts.com/dc3401.pdf",
        field: "resource",
        kind: "new",
        safety: false,
        current: null,
        proposed: { title: "DC3401 manual", url: "https://wenproducts.com/dc3401.pdf", type: "Manual" },
        citations: [],
      })}
      onAccept={vi.fn()}
    />
  );
  expect(screen.getByRole("link", { name: "DC3401 manual" })).toHaveAttribute("href", "https://wenproducts.com/dc3401.pdf");
  expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
});

it("marks a conflict, and a card decided already offers nothing", () => {
  const { rerender } = render(<ProposalCard proposal={proposal({ decision: "conflict" })} onAccept={vi.fn()} />);
  expect(screen.getByText("Changed since — decide again")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();

  rerender(<ProposalCard proposal={proposal({ decision: "accepted" })} onAccept={vi.fn()} />);
  expect(screen.getByText("Accepted")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
});

it("says why a rename cannot be accepted without publish permission", () => {
  render(
    <ProposalCard
      proposal={proposal({ field: "name", id: "name", safety: false, current: "Drill", proposed: "Impact driver" })}
      onAccept={vi.fn()}
      blockedReason="Renaming a published tool needs publish permission."
    />
  );
  expect(screen.getByText("Renaming a published tool needs publish permission.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
});

it("an unverified field shows no values and no controls", () => {
  render(<ProposalCard proposal={proposal({ kind: "unverified", proposed: undefined, citations: [] })} onAccept={vi.fn()} />);
  expect(screen.getByText("Not found")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
