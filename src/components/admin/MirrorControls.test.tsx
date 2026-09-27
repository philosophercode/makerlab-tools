import { render, screen, userEvent } from "../../../test/utils/render";
import type { MirrorActionResult } from "../../app/admin/mirror/action-result";
import type { MirrorView } from "../../lib/mirror/types";
import { MirrorControls, type MirrorControlActions } from "./MirrorControls";

/**
 * Sync now, Pause / Resume and Disconnect (spec §3.8 "Controls", §8, Article 4).
 *
 * The promises: Sync now is disabled with its reason — above all the
 * once-per-15-minutes one, with the time left — rather than failing on click;
 * a refusal from the server is shown, never a success over it; and Disconnect
 * asks first, inline.
 */

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

function actions(over: Partial<MirrorControlActions> = {}): MirrorControlActions {
  return {
    syncNow: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: true })),
    setPaused: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: true })),
    disconnect: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: true })),
    ...over,
  };
}

const syncButton = () => screen.getByRole("button", { name: "Sync now" });

describe("MirrorControls", () => {
  it("starts a sync and says so only once the server agreed", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    render(<MirrorControls view={view()} actions={bundle} />);

    expect(syncButton()).toBeEnabled();
    await user.click(syncButton());

    expect(bundle.syncNow).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Sync started.")).toBeInTheDocument();
  });

  it("disables Sync now inside the 15-minute window, with the reason and the time left", () => {
    // Half a minute short of ten: the clock is read in 15-second steps, so this is 9.5–9.75 minutes away.
    const inTenMinutes = new Date(Date.now() + 10 * 60_000 - 30_000).toISOString();
    render(<MirrorControls view={view({ syncAvailableAt: inTenMinutes })} actions={actions()} />);

    expect(syncButton()).toBeDisabled();
    const reason = screen.getByText(/Sync now runs once every 15 minutes\./);
    expect(reason).toHaveTextContent("Available again in 10 minutes.");
    expect(syncButton()).toHaveAccessibleDescription(reason.textContent ?? "");
  });

  it("enables Sync now once the window has passed", () => {
    const aMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    render(<MirrorControls view={view({ syncAvailableAt: aMinuteAgo })} actions={actions()} />);
    expect(syncButton()).toBeEnabled();
  });

  it("shows the server's refusal and how long is left, and no success", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      syncNow: vi.fn(async (): Promise<MirrorActionResult> => ({
        ok: false,
        error: "sync_too_soon",
        retryAfterSeconds: 7 * 60,
      })),
    });
    render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(syncButton());
    const status = await screen.findByText(/Sync now runs once every 15 minutes\. Available again in 7 minutes\./);
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByText("Sync started.")).not.toBeInTheDocument();
  });

  it("renders a gate refusal from the shared admin errors", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      syncNow: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: false, error: "not_permitted" })),
    });
    render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(syncButton());
    expect(await screen.findByText("Your account does not hold the permission this needs.")).toBeInTheDocument();
  });

  it("treats a rejected call as failed", async () => {
    const user = userEvent.setup();
    const bundle = actions({ syncNow: vi.fn(async () => Promise.reject(new Error("network"))) });
    render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(syncButton());
    expect(await screen.findByText("That did not save. Nothing was changed.")).toBeInTheDocument();
  });

  it("disables Sync now on a paused mirror, and on one with no databases, saying why", () => {
    const { unmount } = render(<MirrorControls view={view({ paused: true })} actions={actions()} />);
    expect(syncButton()).toBeDisabled();
    expect(screen.getByText("Resume the mirror to sync it.")).toBeInTheDocument();
    unmount();

    render(<MirrorControls view={view({ mapping: {} })} actions={actions()} />);
    expect(syncButton()).toBeDisabled();
    expect(screen.getByText("Create or map the databases first.")).toBeInTheDocument();
  });

  it("pauses and resumes", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    const { unmount } = render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(bundle.setPaused).toHaveBeenCalledWith({ paused: true });
    expect(await screen.findByText("Paused.")).toBeInTheDocument();
    unmount();

    render(<MirrorControls view={view({ paused: true })} actions={bundle} />);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(bundle.setPaused).toHaveBeenLastCalledWith({ paused: false });
  });

  it("asks before disconnecting, and Cancel changes nothing", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByText(/Forget the token\?/)).toBeInTheDocument();
    expect(bundle.disconnect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Forget the token\?/)).not.toBeInTheDocument();
    expect(bundle.disconnect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    expect(bundle.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation open and says why when Disconnect is refused", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      disconnect: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: false, error: "rate_limited" })),
    });
    render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    expect(await screen.findByText(/Too many changes at once/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, disconnect" })).toBeInTheDocument();
  });

  it("shows the audit warning on a disconnect that landed without its event", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      disconnect: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: true, warning: "audit_unavailable" })),
    });
    render(<MirrorControls view={view()} actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Yes, disconnect" }));
    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
  });
});
