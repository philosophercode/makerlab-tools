import { REVALIDATE_ENDPOINT, RefreshCatalogButton } from "./RefreshCatalogButton";
import { act, render, screen, userEvent, waitFor } from "../../test/utils/render";
import { DONE_MS } from "./system/AsyncButton";

/**
 * Since 2026-09-23 the control lives in `/admin`'s action row
 * (`admin/AdminActions`), not the header; since 2026-09-25 it is **Refresh
 * catalog** and its state lives in the button (`AsyncButton`).
 *
 * The control is gated twice — here for presentation, and in
 * `/api/admin/revalidate` for real. These tests cover the presentation half;
 * `src/app/api/admin/revalidate/route.test.ts` covers the half that matters.
 *
 * `fetch` is replaced outright, so nothing reaches MSW or the network.
 */

function stubFetch(result: Promise<{ ok: boolean }> | { ok: boolean }) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => (await result) as unknown as Response);
}

const theButton = () => screen.getByRole("button", { name: "Refresh catalog" });

describe("RefreshCatalogButton — who can see it", () => {
  it("renders nothing while identity is still resolving", () => {
    const { container } = render(<RefreshCatalogButton role={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["anonymous", "user"] as const)("renders nothing for %s", (role) => {
    const { container } = render(<RefreshCatalogButton role={role} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(["admin", "super_admin"] as const)("renders for %s, labelled Refresh catalog", (role) => {
    render(<RefreshCatalogButton role={role} />);
    expect(theButton()).toBeInTheDocument();
  });

  it("is the shared quiet Button, not the header's chrome", () => {
    render(<RefreshCatalogButton role="admin" />);
    expect(theButton()).toHaveAttribute("data-slot", "button");
    expect(theButton()).toHaveAttribute("data-variant", "quiet");
  });
});

describe("RefreshCatalogButton — refreshing", () => {
  it("posts to the existing revalidate endpoint, with no secret header", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch({ ok: true });
    render(<RefreshCatalogButton role="admin" />);

    await user.click(theButton());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(REVALIDATE_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(JSON.stringify(init?.headers)).not.toContain("x-admin-secret");
  });

  it("is busy and disabled while the request is in flight, keeping its label in place", async () => {
    const user = userEvent.setup();
    let settle: (value: { ok: boolean }) => void = () => {};
    stubFetch(new Promise<{ ok: boolean }>((resolve) => (settle = resolve)));
    render(<RefreshCatalogButton role="admin" />);

    const button = theButton();
    await user.click(button);

    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-state", "pending");
    // No sentence beside the button while it works.
    expect(screen.queryByText(/Refreshing/)).not.toBeInTheDocument();

    settle({ ok: true });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("flashes Done in the button, announces it, then returns to its label", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      stubFetch({ ok: true });
      render(<RefreshCatalogButton role="admin" />);

      await user.click(theButton());

      expect(await screen.findByRole("button", { name: "Done" })).toHaveAttribute("data-state", "done");
      expect(screen.getByRole("status")).toHaveTextContent("Catalog refreshed");

      await act(async () => {
        vi.advanceTimersByTime(DONE_MS + 10);
      });
      expect(theButton()).toHaveAttribute("data-state", "idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a failure on the line beside the button when the endpoint refuses", async () => {
    const user = userEvent.setup();
    stubFetch({ ok: false });
    render(<RefreshCatalogButton role="admin" />);

    await user.click(theButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Refresh failed/);
    expect(theButton()).toBeEnabled();
  });

  it("can be retried after the request never landed", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true } as unknown as Response);
    render(<RefreshCatalogButton role="admin" />);

    await user.click(theButton());
    await screen.findByRole("alert");

    await user.click(theButton());

    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
