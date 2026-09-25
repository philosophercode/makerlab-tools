const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { act, render, screen, userEvent, within } from "../../../test/utils/render";
import { INTAKE_POLL_INTERVAL_MS } from "../../lib/intake/limits";
import type { PendingToolView } from "../../lib/intake/types";
import { IntakeList } from "./IntakeList";

/**
 * The review queue (spec §5.4 step 10, the unhappy paths, §6 States).
 *
 * Three promises matter here. The page keeps itself current while research
 * runs and stops asking the moment nothing is running. A workflow that failed
 * to start shows why and offers Retry, which is the same request as Research.
 * And the queue is in the order somebody remembers it: by the batch they
 * identified, newest first.
 */

function item(over: Partial<PendingToolView> = {}): PendingToolView {
  return {
    id: "0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e01",
    batchId: "batch-a",
    status: "identified",
    name: "Glowforge Pro",
    brand: "Glowforge",
    categoryHint: "Laser",
    locationHint: null,
    serialNumber: null,
    duplicateOf: null,
    duplicateResolution: null,
    photos: [],
    confidenceLevel: null,
    researchError: null,
    researchRequestedAt: null,
    hasWorkflowRun: false,
    createdByName: "Niti Parikh",
    createdAt: "2026-03-06T14:55:00.000Z",
    updatedAt: "2026-03-06T14:55:00.000Z",
    ...over,
  };
}

function stubFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

beforeEach(() => {
  router.refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("IntakeList", () => {
  it("says nothing is waiting when the queue is empty", () => {
    render(<IntakeList items={[]} />);
    expect(screen.getByText(/Nothing is waiting for review/)).toBeInTheDocument();
  });

  it("puts the newest batch first, whatever order the items arrive in", () => {
    render(
      <IntakeList
        items={[
          item({
            id: "a1",
            batchId: "older",
            name: "Band saw",
            createdAt: "2026-03-01T10:00:00.000Z",
          }),
          item({
            id: "b1",
            batchId: "newer",
            name: "Prusa MK4S",
            createdAt: "2026-03-06T10:00:00.000Z",
          }),
          item({
            id: "b2",
            batchId: "newer",
            name: "Vinyl cutter",
            createdAt: "2026-03-06T10:00:00.000Z",
          }),
        ]}
      />
    );

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["2 items identified 2026-03-06", "1 item identified 2026-03-01"]);

    const names = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(names).toEqual(["Prusa MK4S", "Vinyl cutter", "Band saw"]);
  });

  it("shows each row's status, grade, who identified it and its duplicate", () => {
    render(
      <IntakeList
        items={[
          item({
            status: "researched",
            confidenceLevel: "medium",
            duplicateOf: {
              kind: "tool",
              id: "t1",
              name: "Form 4",
              slug: "form-4",
              published: true,
            },
            duplicateResolution: "new_tool",
          }),
        ]}
      />
    );

    expect(screen.getByText("Ready for review")).toBeInTheDocument();
    expect(screen.getByText("Needs confirmation")).toBeInTheDocument();
    expect(screen.getByText("Identified by Niti Parikh")).toBeInTheDocument();
    expect(screen.getByText("Matches Form 4, already in the catalog.")).toBeInTheDocument();
    expect(screen.getByText("Marked as a different tool.")).toBeInTheDocument();
  });

  it("links a researched item to its preliminary page", () => {
    render(<IntakeList items={[item({ status: "researched" })]} />);
    expect(screen.getByRole("link", { name: "Glowforge Pro" })).toHaveAttribute(
      "href",
      "/admin/intake/0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e01"
    );
  });

  it("folds approved and discarded items behind a disclosure", () => {
    render(
      <IntakeList
        items={[item({ id: "x", status: "approved" }), item({ id: "y", status: "discarded" })]}
      />
    );
    expect(
      screen.getByText(/Everything identified so far has been approved or discarded/)
    ).toBeInTheDocument();
    expect(screen.getByText("Show 2 approved and discarded")).toBeInTheDocument();
  });

  describe("polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("refreshes while an item is queued, every interval", () => {
      render(<IntakeList items={[item({ status: "queued", hasWorkflowRun: true })]} />);

      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS));
      expect(router.refresh).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS));
      expect(router.refresh).toHaveBeenCalledTimes(2);
    });

    it("refreshes while an item is researching, and stops once none is", () => {
      const { rerender } = render(<IntakeList items={[item({ status: "researching" })]} />);
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS));
      expect(router.refresh).toHaveBeenCalledTimes(1);

      // The refresh came back with research finished.
      rerender(<IntakeList items={[item({ status: "researched", confidenceLevel: "high" })]} />);
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS * 3));
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it("never polls a queue with nothing in flight", () => {
      render(
        <IntakeList
          items={[
            item({ id: "a", status: "identified" }),
            item({ id: "b", status: "failed", researchError: "Model call timed out" }),
            // Queued with an error is a start that failed: nothing is running.
            item({ id: "c", status: "queued", researchError: "Could not start research: 503" }),
          ]}
        />
      );
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS * 3));
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("keeps asking while a start is only moments old", () => {
      render(
        <IntakeList
          items={[item({ status: "queued", researchRequestedAt: new Date(Date.now() - 30_000).toISOString() })]}
        />
      );
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS));
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it("stops asking about a start that stalled with nothing recorded", () => {
      render(
        <IntakeList
          items={[item({ status: "queued", researchRequestedAt: new Date(Date.now() - 10 * 60_000).toISOString() })]}
        />
      );
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS * 3));
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("clears the interval on unmount", () => {
      const { unmount } = render(<IntakeList items={[item({ status: "queued", hasWorkflowRun: true })]} />);
      unmount();
      act(() => vi.advanceTimersByTime(INTAKE_POLL_INTERVAL_MS * 3));
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });

  describe("Research and Retry", () => {
    it("shows why a start failed, and Retry POSTs the id and renders the refusal", async () => {
      const fetchSpy = stubFetch(502, {
        code: "start_failed",
        error: "Could not start research",
        ids: ["0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e01"],
      });
      render(
        <IntakeList
          items={[
            item({ status: "queued", researchError: "Could not start research: world down" }),
          ]}
        />
      );

      expect(screen.getByText("Research could not start")).toBeInTheDocument();
      expect(screen.getByText("Could not start research: world down")).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("button", { name: "Retry research for Glowforge Pro" })
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/pending-tools/research");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        ids: ["0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e01"],
      });
      expect(
        await screen.findByText("Research could not start. The item is still queued — press Retry.")
      ).toBeInTheDocument();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("offers Retry on a failed item, with its diagnosis under a translated label", () => {
      render(
        <IntakeList items={[item({ status: "failed", researchError: "Model call timed out" })]} />
      );

      const card = screen.getByRole("listitem");
      expect(within(card).getByText("What went wrong")).toBeInTheDocument();
      expect(within(card).getByText("Model call timed out")).toBeInTheDocument();
      expect(
        within(card).getByRole("button", { name: "Retry research for Glowforge Pro" })
      ).toBeInTheDocument();
    });

    it("sends an identified item to research and asks for a fresh render", async () => {
      stubFetch(202, { requestId: "r", runId: "run-1", queued: ["x"], readyAsUnit: [] });
      render(<IntakeList items={[item()]} />);

      await userEvent.click(screen.getByRole("button", { name: "Research Glowforge Pro" }));

      expect(await screen.findByText(/Research started/)).toBeInTheDocument();
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it("reads a body it does not recognise as failed, never as success", async () => {
      stubFetch(500, { nope: true });
      render(<IntakeList items={[item()]} />);

      await userEvent.click(screen.getByRole("button", { name: "Research Glowforge Pro" }));

      expect(await screen.findByText(/That did not go through/)).toBeInTheDocument();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("offers no research control on an item already researching", () => {
      render(<IntakeList items={[item({ status: "researching" })]} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("Discard and duplicates, for items left behind", () => {
    it("discards an identified item after an inline confirmation, through the card's route", async () => {
      const fetchSpy = stubFetch(200, { item: item({ status: "discarded" }) });
      render(<IntakeList items={[item()]} />);

      await userEvent.click(screen.getByRole("button", { name: "Discard Glowforge Pro" }));
      // Nothing is sent until the confirmation is answered.
      expect(fetchSpy).not.toHaveBeenCalled();
      const confirm = screen.getByRole("group", { name: "Discard Glowforge Pro" });
      expect(within(confirm).getByText(/Its photos are deleted with it/)).toBeInTheDocument();

      await userEvent.click(within(confirm).getByRole("button", { name: "Yes, discard" }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/pending-tools/0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e01");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ discard: true });
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it("keeps the item when the confirmation is declined", async () => {
      const fetchSpy = stubFetch(200, {});
      render(<IntakeList items={[item()]} />);

      await userEvent.click(screen.getByRole("button", { name: "Discard Glowforge Pro" }));
      await userEvent.click(screen.getByRole("button", { name: "Keep it" }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Discard Glowforge Pro" })).toBeInTheDocument();
    });

    it("renders a refused discard and asks for no refresh", async () => {
      stubFetch(409, { code: "not_editable", error: "moved on" });
      render(<IntakeList items={[item({ status: "failed", researchError: "Timed out" })]} />);

      await userEvent.click(screen.getByRole("button", { name: "Discard Glowforge Pro" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, discard" }));

      expect(await screen.findByText(/This item has moved on/)).toBeInTheDocument();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it("marks an undecided duplicate as a different tool, so it can be researched", async () => {
      const fetchSpy = stubFetch(200, { item: item({ duplicateResolution: "new_tool" }) });
      render(
        <IntakeList
          items={[
            item({
              duplicateOf: { kind: "pending", id: "p1", name: "Glowforge Plus", status: "identified" },
            }),
          ]}
        />
      );

      await userEvent.click(
        screen.getByRole("radio", { name: "Mark Glowforge Pro as a different tool" })
      );

      const [, init] = fetchSpy.mock.calls[0];
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ duplicateResolution: "new_tool" });
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it("offers no duplicate decision once one is made, and no Discard while research runs", () => {
      render(
        <IntakeList
          items={[
            item({
              id: "a",
              duplicateOf: { kind: "pending", id: "p1", name: "Glowforge Plus", status: "identified" },
              duplicateResolution: "new_tool",
            }),
            item({ id: "b", name: "Queued saw", status: "queued", hasWorkflowRun: true }),
          ]}
        />
      );

      expect(
        screen.queryByRole("radio", { name: "Mark Glowforge Pro as a different tool" })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Discard Queued saw" })).not.toBeInTheDocument();
    });

    it("adds an undecided catalogue duplicate as another unit, with its serial", async () => {
      const fetchSpy = stubFetch(200, { item: item({ duplicateResolution: "add_unit" }) });
      render(
        <IntakeList
          items={[
            item({
              name: "Prusa MK4",
              serialNumber: "SN-9",
              duplicateOf: { kind: "tool", id: "t1", name: "Prusa MK4", slug: "prusa-mk4", published: true },
            }),
          ]}
        />
      );

      await userEvent.click(
        screen.getByRole("radio", { name: "Add Prusa MK4 as another unit of the tool it matches" })
      );
      const serial = screen.getByLabelText("Serial number");
      expect(serial).toHaveValue("SN-9");
      await userEvent.clear(serial);
      await userEvent.type(serial, "SN-10");
      await userEvent.click(screen.getByRole("button", { name: "Add as a unit" }));

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/pending-tools/0f6c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e01");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({ duplicateResolution: "add_unit", serialNumber: "SN-10" });
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it("offers Add as another unit only for a match in the catalogue", () => {
      render(
        <IntakeList
          items={[
            item({
              duplicateOf: { kind: "pending", id: "p1", name: "Glowforge Plus", status: "identified" },
            }),
          ]}
        />
      );
      expect(screen.queryByRole("radio", { name: /as another unit/ })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Mark Glowforge Pro as a different tool" })).toBeInTheDocument();
    });

    it("offers Retry and Discard for a start that stalled with nothing recorded, and says why", () => {
      render(
        <IntakeList
          items={[item({ status: "queued", researchRequestedAt: "2020-01-01T00:00:00.000Z" })]}
        />
      );

      expect(screen.getByText("Research could not start")).toBeInTheDocument();
      expect(screen.getByText(/queued but never started/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry research for Glowforge Pro" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Discard Glowforge Pro" })).toBeInTheDocument();
    });
  });
});
