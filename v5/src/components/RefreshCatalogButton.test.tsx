import { REVALIDATE_ENDPOINT, RefreshCatalogButton } from "./RefreshCatalogButton";
import { render, screen, userEvent, waitFor } from "../../test/utils/render";

/**
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

// en.json: catalogRefresh.action = "REFRESH".
describe("RefreshCatalogButton — who can see it", () => {
  it("renders nothing while identity is still resolving", () => {
    const { container } = render(<RefreshCatalogButton role={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an anonymous visitor", () => {
    const { container } = render(<RefreshCatalogButton role="anonymous" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a signed-in student", () => {
    const { container } = render(<RefreshCatalogButton role="student" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders for staff", () => {
    render(<RefreshCatalogButton role="staff" />);
    expect(screen.getByRole("button", { name: /Refresh the/ })).toHaveTextContent(
      "REFRESH"
    );
  });

  it("renders for admin", () => {
    render(<RefreshCatalogButton role="admin" />);
    expect(screen.getByRole("button", { name: /Refresh the/ })).toBeInTheDocument();
  });

  it("names the institution from config rather than leaving the placeholder", () => {
    render(<RefreshCatalogButton role="staff" />);

    const button = screen.getByRole("button", { name: /Refresh the/ });
    // A next-intl placeholder with no argument renders literally — this has
    // already been a real bug on this branch (Article 6).
    expect(button.getAttribute("aria-label")).toContain("Cornell Tech");
    expect(button.getAttribute("aria-label")).not.toContain("{institution}");
  });
});

// en.json: refreshing = "Refreshing…", refreshed = "Catalog refreshed",
// failed = "Refresh failed — try again".
describe("RefreshCatalogButton — refreshing", () => {
  it("posts to the existing revalidate endpoint, with no secret header", async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch({ ok: true });
    render(<RefreshCatalogButton role="staff" />);

    await user.click(screen.getByRole("button", { name: /Refresh the/ }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(REVALIDATE_ENDPOINT);
    expect(init?.method).toBe("POST");
    // The session cookie is the credential; the browser must never hold the
    // shared secret.
    expect(JSON.stringify(init?.headers)).not.toContain("x-admin-secret");
  });

  it("says nothing until the staff member asks", () => {
    const { container } = render(<RefreshCatalogButton role="staff" />);

    // The live region is in the DOM from the start so an announcement lands
    // when it arrives, but `:empty` keeps it out of the layout (and out of the
    // accessibility tree) until there is something to say — which is why this
    // queries the node directly rather than by role.
    expect(container.querySelector('[role="status"]')).toBeEmptyDOMElement();
  });

  it("reports refreshing while the request is in flight, and disables the control", async () => {
    const user = userEvent.setup();
    let settle: (value: { ok: boolean }) => void = () => {};
    stubFetch(new Promise<{ ok: boolean }>((resolve) => (settle = resolve)));
    render(<RefreshCatalogButton role="staff" />);

    const button = screen.getByRole("button", { name: /Refresh the/ });
    await user.click(button);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Refreshing…")
    );
    expect(button).toBeDisabled();

    settle({ ok: true });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("confirms in place, not in a toast — the message stays on screen", async () => {
    const user = userEvent.setup();
    stubFetch({ ok: true });
    render(<RefreshCatalogButton role="staff" />);

    await user.click(screen.getByRole("button", { name: /Refresh the/ }));

    const status = await screen.findByText("Catalog refreshed");
    expect(status).toBeInTheDocument();
    // Nothing dismisses it: a refresh is worth confirming, and a toast is gone
    // before it is read.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("Catalog refreshed")).toBeInTheDocument();
  });

  it("reports failure when the endpoint refuses", async () => {
    const user = userEvent.setup();
    stubFetch({ ok: false });
    render(<RefreshCatalogButton role="staff" />);

    await user.click(screen.getByRole("button", { name: /Refresh the/ }));

    expect(await screen.findByText(/Refresh failed/)).toBeInTheDocument();
  });

  it("reports failure when the request never lands", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(<RefreshCatalogButton role="staff" />);

    await user.click(screen.getByRole("button", { name: /Refresh the/ }));

    expect(await screen.findByText(/Refresh failed/)).toBeInTheDocument();
  });

  it("can be retried after a failure", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true } as unknown as Response);
    render(<RefreshCatalogButton role="staff" />);

    const button = screen.getByRole("button", { name: /Refresh the/ });
    await user.click(button);
    await screen.findByText(/Refresh failed/);

    await user.click(button);

    expect(await screen.findByText("Catalog refreshed")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
