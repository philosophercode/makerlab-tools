const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { act, render, screen, within } from "../../../test/utils/render";
import { MIRROR_POLL_INTERVAL_MS } from "../../lib/mirror/limits";
import type { MirrorView } from "../../lib/mirror/types";
import { MirrorStatus } from "./MirrorStatus";

/**
 * The mirror's status panel (spec §3.8 "Status", §5.8, §10: "`MirrorStatus`:
 * shows last synced, paused, and the last error").
 *
 * What it must never do is let a reader infer the wrong thing: a mirror that
 * never pushed says "Never", not a blank; a paused one says so in words; a
 * push that ran out of time says the rest waits for the next push, and which
 * tables it concerned; and while a push is running the page keeps asking for
 * a fresh render until it is not.
 */

const TZ = "America/New_York";

function view(over: Partial<MirrorView> = {}): MirrorView {
  return {
    id: "6c8f3a3e-6f0b-4d62-9d39-2a8b2f7b1e01",
    connected: true,
    parentPageId: "0f5e4a3c-1111-2222-3333-44445555aaaa",
    parentPageTitle: "MakerLab Tools — mirror",
    mapping: { tools: "1a2b3c4d-0000-4000-8000-000000000001" },
    paused: false,
    running: false,
    syncPending: false,
    pushScheduled: false,
    lastSyncedAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    syncAvailableAt: null,
    ...over,
  };
}

/** The value beside a `<dt>` label. */
function fact(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling as HTMLElement;
}

beforeEach(() => {
  router.refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MirrorStatus", () => {
  it("shows when it last synced, in the lab's time zone, and the result", () => {
    render(
      <MirrorStatus
        view={view({
          lastSyncedAt: "2026-09-23T14:05:00.000Z",
          lastRunAt: "2026-09-23T14:10:00.000Z",
          lastStatus: "ok",
        })}
        timeZone={TZ}
      />
    );

    const synced = within(fact("Last synced")).getByText(/2026/);
    expect(synced.tagName).toBe("TIME");
    expect(synced).toHaveAttribute("datetime", "2026-09-23T14:05:00.000Z");
    // 14:05 UTC is 10:05 in New York in September — formatted, not raw ISO.
    expect(synced).toHaveTextContent(/Sep 23, 2026/);
    expect(synced).toHaveTextContent(/10:05/);
    // The time is a safety watermark, so the panel says what it guarantees.
    expect(fact("Last synced")).toHaveTextContent("Every change made before this time is in Notion.");
    expect(within(fact("Last run")).getByText(/10:10/)).toBeInTheDocument();
    expect(fact("Last result")).toHaveTextContent("OK");
    expect(screen.getByText("Connected to “MakerLab Tools — mirror”.")).toBeInTheDocument();
  });

  it("never says Connected once the token has been forgotten", () => {
    render(<MirrorStatus view={view({ connected: false })} timeZone={TZ} />);

    expect(screen.getByText("Disconnected. It last pushed to “MakerLab Tools — mirror”.")).toBeInTheDocument();
    expect(screen.queryByText(/^Connected to/)).not.toBeInTheDocument();
  });

  it("says a mirror that never pushed has never synced", () => {
    render(<MirrorStatus view={view()} timeZone={TZ} />);

    expect(fact("Last synced")).toHaveTextContent("Never");
    expect(fact("Last run")).toHaveTextContent("Never");
    expect(fact("Last result")).toHaveTextContent("No push yet");
    expect(screen.getByText(/Nothing has been pushed yet/)).toBeInTheDocument();
    expect(screen.queryByText("Last error")).not.toBeInTheDocument();
  });

  it("says a paused mirror is paused, and shows the error that paused it", () => {
    render(
      <MirrorStatus
        view={view({
          paused: true,
          lastRunAt: "2026-09-23T14:10:00.000Z",
          lastStatus: "failed",
          lastError: { code: "unauthorized", entities: [], failed: 0, detail: "Notion 401 unauthorized: API token is invalid." },
        })}
        timeZone={TZ}
      />
    );

    expect(screen.getByText("Paused. Nothing is pushed until you resume.")).toBeInTheDocument();
    expect(fact("Last result")).toHaveTextContent("Failed");
    expect(screen.getByText("Last error")).toBeInTheDocument();
    expect(screen.getByText(/Notion refused the token, so the mirror paused itself/)).toBeInTheDocument();
    expect(screen.getByText("Notion 401 unauthorized: API token is invalid.")).toBeInTheDocument();
  });

  it("shows a partial push that ran out of time, with the tables and rows it concerned", () => {
    render(
      <MirrorStatus
        view={view({
          lastSyncedAt: "2026-09-22T09:00:00.000Z",
          lastRunAt: "2026-09-23T14:10:00.000Z",
          lastStatus: "partial",
          lastError: { code: "budget_exhausted", entities: ["units", "maintenance"], failed: 3, detail: null },
        })}
        timeZone={TZ}
      />
    );

    expect(fact("Last result")).toHaveTextContent("Partial");
    expect(screen.getByText(/ran out of time before it finished/)).toBeInTheDocument();
    expect(screen.getByText("Tables: Units and Maintenance")).toBeInTheDocument();
    expect(screen.getByText("3 rows failed.")).toBeInTheDocument();
    // `last_synced_at` did not advance on a partial push (§3.8 step 5), and the
    // panel shows the older time rather than pretending the push finished.
    expect(within(fact("Last synced")).getByText(/Sep 22, 2026/)).toBeInTheDocument();
  });

  it("reads an error code it does not know as unknown rather than a raw key", () => {
    render(
      <MirrorStatus
        view={view({
          lastStatus: "failed",
          lastError: { code: "exploded" as never, entities: ["nonsense" as never], failed: 0, detail: null },
        })}
        timeZone={TZ}
      />
    );
    expect(screen.getByText(/for a reason the app does not recognise/)).toBeInTheDocument();
    expect(screen.queryByText(/Tables:/)).not.toBeInTheDocument();
  });

  it("says a push is running, and polls until it is not", () => {
    vi.useFakeTimers();
    const { rerender } = render(<MirrorStatus view={view({ running: true })} timeZone={TZ} />);

    expect(screen.getByText("Pushing to Notion now…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(MIRROR_POLL_INTERVAL_MS * 2);
    });
    expect(router.refresh).toHaveBeenCalledTimes(2);

    rerender(<MirrorStatus view={view({ lastStatus: "ok", lastSyncedAt: "2026-09-23T14:05:00.000Z" })} timeZone={TZ} />);
    router.refresh.mockClear();
    act(() => {
      vi.advanceTimersByTime(MIRROR_POLL_INTERVAL_MS * 3);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("polls while a Sync now waits to start, and says so", () => {
    vi.useFakeTimers();
    render(<MirrorStatus view={view({ syncPending: true })} timeZone={TZ} />);

    expect(screen.getByText(/Sync requested/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(MIRROR_POLL_INTERVAL_MS);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not poll for a push merely scheduled after recent changes, but says it is coming", () => {
    vi.useFakeTimers();
    render(<MirrorStatus view={view({ pushScheduled: true })} timeZone={TZ} />);

    expect(screen.getByText(/Recent changes will be pushed/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(MIRROR_POLL_INTERVAL_MS * 3);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
