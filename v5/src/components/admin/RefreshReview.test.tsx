const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { act, render, screen, userEvent, within } from "../../../test/utils/render";
import { INTAKE_POLL_INTERVAL_MS } from "../../lib/intake/limits";
import type { FieldProposal } from "../../lib/refresh/types";
import { RefreshList, type RefreshListRow } from "./RefreshList";
import { RefreshReview, type RefreshReviewView } from "./RefreshReview";

/**
 * The review pages (refresh research spec §5.2, §6): the list says what is
 * waiting and polls while research runs; one refresh's page decides cards,
 * accept-all, reject-all, refresh again, and says a conflict.
 */

const verified = [{ quote: "a quote on the page", url: "https://a.example/", verified: true }];

function proposal(overrides: Partial<FieldProposal> & Pick<FieldProposal, "field">): FieldProposal {
  return { id: overrides.field, kind: "differs", safety: false, current: "old", proposed: "new", citations: verified, decision: "pending", ...overrides };
}

function view(overrides: Partial<RefreshReviewView> = {}): RefreshReviewView {
  return {
    id: "r1",
    status: "proposed",
    rowRevision: "123.4",
    tool: { id: "t1", name: "WEN DC3401", slug: "wen-dc3401", published: true, archived: false },
    proposals: [
      proposal({ field: "use_restrictions", safety: true }),
      proposal({ field: "name" }),
      proposal({ field: "emergency_stop", kind: "unverified", proposed: undefined, citations: [] }),
    ],
    note: null,
    includeDescription: false,
    researchError: null,
    categorySuggestion: "Dust Collection",
    duplicateOf: null,
    canPublish: true,
    ...overrides,
  };
}

function actions() {
  return {
    decide: vi.fn(async () => ({ ok: true as const, applied: 1 })),
    again: vi.fn(async () => ({ ok: true as const, queued: 1, skipped: 0, missing: 0 })),
  };
}

beforeEach(() => router.refresh.mockClear());

describe("RefreshReview", () => {
  it("shows one card per change, safety first, and the fields research found nothing for apart", async () => {
    render(<RefreshReview view={view()} actions={actions()} />);
    const cards = within(screen.getByRole("region", { name: "Proposed changes" })).getAllByRole("article");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(["Use restrictions", "Display name"]);
    expect(screen.getByText(/No manufacturer source found \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Research would file this under Dust Collection/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in editor" })).toHaveAttribute("href", "/tools/wen-dc3401");
  });

  it("accepts one card against the page's revision, then asks for a fresh render", async () => {
    const a = actions();
    render(<RefreshReview view={view()} actions={a} />);
    await userEvent.click(within(screen.getByRole("article", { name: "Use restrictions" })).getByRole("button", { name: "Accept" }));
    expect(a.decide).toHaveBeenCalledWith({ refreshId: "r1", rowRevision: "123.4", decision: "accept", ids: ["use_restrictions"] });
    expect(await screen.findByText("1 change saved.")).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("accept all verified and reject all send the page-level decisions", async () => {
    const a = actions();
    render(<RefreshReview view={view()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept all verified" }));
    await userEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(a.decide.mock.calls.map((call) => (call as unknown as [{ decision: string }])[0].decision)).toEqual(["accept_all_verified", "reject_all"]);
  });

  it("says a conflict above the cards", async () => {
    const a = actions();
    a.decide.mockResolvedValueOnce({ ok: false, error: "conflict" } as never);
    render(<RefreshReview view={view()} actions={a} />);
    await userEvent.click(within(screen.getByRole("article", { name: "Display name" })).getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/The tool was edited since this refresh was queued/)).toBeInTheDocument();
  });

  it("offers Refresh again with a note", async () => {
    const a = actions();
    render(<RefreshReview view={view({ status: "failed", researchError: "Research (search): the provider refused.", proposals: [] })} actions={a} />);
    expect(screen.getByText("Research (search): the provider refused.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh again" }));
    await userEvent.type(screen.getByLabelText("Note for research (optional)"), "check the manual");
    await userEvent.click(screen.getByRole("button", { name: "Start refresh" }));
    expect(a.again).toHaveBeenCalledWith({ refreshId: "r1", note: "check the manual", includeDescription: false });
  });

  it("says Matches when there is nothing to change", () => {
    render(<RefreshReview view={view({ status: "decided", proposals: [] })} actions={actions()} />);
    expect(screen.getByText("Matches the manufacturer's pages — nothing to change.")).toBeInTheDocument();
  });

  it("disables a rename the person may not publish", () => {
    render(<RefreshReview view={view({ canPublish: false })} actions={actions()} />);
    expect(within(screen.getByRole("article", { name: "Display name" })).getByRole("button", { name: "Accept" })).toBeDisabled();
  });
});

describe("RefreshList", () => {
  const row = (overrides: Partial<RefreshListRow>): RefreshListRow => ({
    id: "r1",
    toolName: "WEN DC3401",
    status: "proposed",
    rank: 0,
    counts: { differs: 1, new: 0, unverified: 2, safety: 1 },
    researchError: null,
    requestedAt: "2026-09-23T10:00:00.000Z",
    ...overrides,
  });

  it("links each refresh with its counts, and says an empty queue", () => {
    const { rerender } = render(<RefreshList rows={[row({}), row({ id: "r2", toolName: "Form 2", rank: 4, counts: { differs: 0, new: 0, unverified: 0, safety: 0 } })]} />);
    expect(screen.getByRole("link", { name: "WEN DC3401" })).toHaveAttribute("href", "/admin/refresh/r1");
    expect(screen.getByText(/Differs 1 · New 0 · Not found 2/)).toBeInTheDocument();
    expect(screen.getByText("1 safety")).toBeInTheDocument();
    expect(screen.getByText("Matches the manufacturer's pages")).toBeInTheDocument();
    rerender(<RefreshList rows={[]} />);
    expect(screen.getByText(/No refreshes waiting/)).toBeInTheDocument();
  });

  it("polls while a refresh is running, and stops when none is", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<RefreshList rows={[row({ status: "researching" })]} />);
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS));
      expect(router.refresh).toHaveBeenCalledTimes(1);
      rerender(<RefreshList rows={[row({})]} />);
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS * 3));
      expect(router.refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
