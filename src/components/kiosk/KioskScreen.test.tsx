import { act, render, screen, within } from "../../../test/utils/render";
import type { KioskSnapshot } from "@/lib/kiosk/types";
import { KioskScreen } from "./KioskScreen";

/**
 * The lab status screen (kiosk spec §10, component layer): fresh, stale,
 * offline, ticket count unread, empty and demo states; the poll keeping its
 * last snapshot through failures and backing off; the featured rotation and
 * its reduced-motion cut; the burn-in shift.
 */

const T0 = Date.parse("2026-10-11T14:00:00Z"); // 10:00 in New York
const TZ = "America/New_York";

function snapshot(overrides: Partial<KioskSnapshot> = {}): KioskSnapshot {
  return {
    generatedAt: new Date(T0).toISOString(),
    demo: false,
    lab: { hoursText: "LAB OPEN 9AM-9PM", openNow: null, closesAt: null },
    unitsInService: 12,
    down: [
      { toolSlug: "form-4", toolName: "Form 4", imageSrc: "/tool-images/Form%204.png", unitsDown: 1, unitsTotal: 2, state: "under_maintenance" },
      { toolSlug: "trotec", toolName: "Trotec Speedy 400", imageSrc: "", unitsDown: 1, unitsTotal: 1, state: "out_of_service" },
    ],
    tickets: { open: 5, inProgress: 2 },
    featured: [
      { kind: "tool", slug: "dremel", name: "Dremel 3000", shortDescription: "A rotary tool.", imageSrc: "" },
      { kind: "project", slug: "lamp", title: "Laser-cut lamp", coverSrc: "", toolNames: ["Trotec Speedy 400"], author: "Maya R." },
    ],
    askUrl: "https://makerlab-ai.vercel.app/?src=kiosk&ask=1",
    onShift: [],
    ...overrides,
  };
}

const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path stroke="currentColor" d="M0 0.5h7"/></svg>';

function renderScreen(initial: KioskSnapshot | null = snapshot()) {
  return render(
    <KioskScreen initial={initial} renderedAt={T0} qrSvg={QR} askUrl="https://makerlab-ai.vercel.app/?src=kiosk&ask=1" timeZone={TZ} />
  );
}

const fetchMock = vi.fn<typeof fetch>();

function answer(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  vi.spyOn(Math, "random").mockReturnValue(0); // no jitter: polls land on the minute
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
});

describe("KioskScreen — what is on screen", () => {
  it("shows the down machines, the ticket figure, the hours, the QR code and when it was updated", () => {
    renderScreen();

    const machines = screen.getByRole("region", { name: "Machines" });
    expect(within(machines).getByText("Form 4")).toBeInTheDocument();
    expect(within(machines).getByText("1 of 2 down")).toBeInTheDocument();
    expect(within(machines).getByText("Under maintenance")).toBeInTheDocument();
    // One unit, and it is down: "Down", not "1 of 1 down".
    expect(within(machines).getByText("Down")).toBeInTheDocument();
    expect(within(machines).getByText("Out of service")).toBeInTheDocument();

    const tickets = screen.getByRole("region", { name: "Open tickets" });
    expect(within(tickets).getByText("7")).toBeInTheDocument();
    expect(tickets).toHaveTextContent("2 being worked on");

    expect(screen.getByText("LAB OPEN 9AM-9PM")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code that opens https://makerlab-ai.vercel.app/?src=kiosk&ask=1" })).toBeInTheDocument();
    expect(screen.getByText("makerlab-ai.vercel.app")).toBeInTheDocument();
    expect(screen.getByText("Updated 10:00 AM")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Lab status");
  });

  it("is fresh: no bar, no demo chip, and dark whatever the page had", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { container } = renderScreen();
    expect(container.querySelector("[data-kiosk-bar]")).toBeNull();
    expect(container.querySelector("[data-kiosk-demo]")).toBeNull();
    expect(container.querySelector("[data-kiosk]")).toHaveAttribute("data-staleness", "fresh");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("heads the top bar with the lab's official logo, beside the title that names the lab", () => {
    const { container } = renderScreen();
    const logo = container.querySelector('[data-kiosk] header [data-slot="brand-logo"]') as HTMLElement;
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo.style.maskImage || logo.getAttribute("style")).toContain("/brand/cornell-tech-makerlab-logo.svg");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("MakerLAB Tools");
  });

  it("says all machines are running, with how many, when nothing is down", () => {
    renderScreen(snapshot({ down: [] }));
    expect(screen.getByText("All machines running")).toBeInTheDocument();
    expect(screen.getByText("12 machines in service")).toBeInTheDocument();
  });

  it("shows '—' and 'Not available' for a ticket count it could not read — never 0", () => {
    renderScreen(snapshot({ tickets: null }));
    const tickets = screen.getByRole("region", { name: "Open tickets" });
    expect(within(tickets).getByText("—")).toBeInTheDocument();
    expect(within(tickets).getByText("Not available")).toBeInTheDocument();
    expect(within(tickets).queryByText("0")).toBeNull();
  });

  it("wears a demo chip on the demo seed", () => {
    const { container } = renderScreen(snapshot({ demo: true }));
    expect(container.querySelector("[data-kiosk-demo]")).toHaveTextContent("Demo data");
  });

  it("says the status is unavailable, and still offers the QR code, when the first read failed", () => {
    renderScreen(null);
    expect(screen.getByText("Lab status is unavailable right now")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR code that opens/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Machines" })).toBeNull();
  });

  it("shows who is on shift, by first name and initial, beside the hours (on-shift spec 2026-10-07)", () => {
    const { container } = renderScreen(snapshot({ onShift: ["Alex M.", "Jordan P."] }));
    const line = container.querySelector("[data-kiosk-on-shift]");
    expect(line).not.toBeNull();
    expect(line).toHaveTextContent("On shift now");
    expect(line).toHaveTextContent("Alex M. and Jordan P.");
  });

  it("shows no on-shift line at all when nobody is on shift, and none for an older payload without the field", () => {
    const { container, unmount } = renderScreen(snapshot({ onShift: [] }));
    expect(container.querySelector("[data-kiosk-on-shift]")).toBeNull();
    expect(container).not.toHaveTextContent("On shift now");
    unmount();
    const older = snapshot();
    delete (older as Partial<KioskSnapshot>).onShift;
    const again = renderScreen(older);
    expect(again.container.querySelector("[data-kiosk-on-shift]")).toBeNull();
  });

  it("shows a featured project's author as first name and initial", () => {
    renderScreen(snapshot({ featured: [snapshot().featured[1]] }));
    const featured = screen.getByRole("region", { name: /Featured/ });
    expect(featured).toHaveTextContent("Laser-cut lamp");
    expect(featured).toHaveTextContent("by Maya R.");
    expect(featured).toHaveTextContent("Built with Trotec Speedy 400");
  });
});

describe("KioskScreen — the refresh loop", () => {
  it("swaps in a new snapshot on the next poll", async () => {
    renderScreen();
    answer(snapshot({ tickets: { open: 8, inProgress: 2 }, down: [] }));

    await advance(60_000);

    expect(fetchMock).toHaveBeenCalledWith("/api/kiosk", expect.objectContaining({ cache: "no-store" }));
    expect(within(screen.getByRole("region", { name: "Open tickets" })).getByText("10")).toBeInTheDocument();
    expect(screen.getByText("All machines running")).toBeInTheDocument();
    expect(screen.getByText("Updated 10:01 AM")).toBeInTheDocument();
  });

  it("keeps the last snapshot through failures, backs off 1 → 2 → 5 minutes, and goes stale at 3 minutes", async () => {
    const { container } = renderScreen();

    await advance(60_000); // 10:01 — first failure
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Form 4")).toBeInTheDocument();
    expect(container.querySelector("[data-kiosk-bar]")).toBeNull();

    await advance(60_000); // 10:02 — second failure, one minute later
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(60_000); // 10:03 — three minutes since the last good answer
    expect(container.querySelector("[data-kiosk-bar]")).toHaveTextContent("Can't reach the server — showing 10:00 AM");
    expect(screen.getByRole("status")).toHaveTextContent("Can't reach the server");
    expect(fetchMock).toHaveBeenCalledTimes(2); // the third waits two minutes

    await advance(60_000); // 10:04 — third failure
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await advance(4 * 60_000); // five minutes after, not before
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Still the last good data, never a blank or a zero.
    expect(screen.getByText("Form 4")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Open tickets" })).getByText("7")).toBeInTheDocument();
  });

  it("treats a non-200 as a failure, not as data", async () => {
    renderScreen();
    answer({ error: "unavailable" }, 503);
    await advance(60_000);
    expect(screen.getByText("Form 4")).toBeInTheDocument();
    expect(screen.queryByText("Lab status is unavailable right now")).toBeNull();
  });

  it("says it is offline at once, and polls the moment the network is back", async () => {
    const { container } = renderScreen();

    act(() => setOnline(false));
    expect(container.querySelector("[data-kiosk-bar]")).toHaveTextContent("Offline — showing 10:00 AM");

    answer(snapshot({ tickets: { open: 1, inProgress: 0 } }));
    await act(async () => {
      setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-kiosk-bar]")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Open tickets" })).getByText("1")).toBeInTheDocument();
  });

  it("recovers from the unavailable state when a poll succeeds", async () => {
    renderScreen(null);
    answer(snapshot());
    await advance(60_000);
    expect(screen.getByRole("region", { name: "Machines" })).toBeInTheDocument();
  });
});

describe("KioskScreen — motion", () => {
  it("rotates the featured item every 20 seconds and keeps its place across a refresh", async () => {
    const { container } = renderScreen();
    const current = () => container.querySelector("[data-kiosk-featured]")?.getAttribute("data-kiosk-featured");
    const first = current();

    await advance(20_000);
    const second = current();
    expect(second).not.toBe(first);

    answer(snapshot());
    await advance(40_000); // a poll lands at 60 s: rotation is by the clock, not reset by new data
    // 60 s is three steps through two items — the second again, exactly where
    // the clock says, not back to the start of the new list.
    expect(current()).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cuts instead of fading under prefers-reduced-motion", () => {
    const { container } = renderScreen();
    const article = container.querySelector("[data-kiosk-featured]");
    expect(article).toHaveClass("animate-in", "fade-in", "motion-reduce:animate-none");
  });

  it("shifts the layout a few pixels every five minutes", async () => {
    const { container } = renderScreen();
    const shift = () => container.querySelector("[data-kiosk-shift]")?.getAttribute("data-kiosk-shift");
    const before = shift();
    await advance(5 * 60_000);
    expect(shift()).not.toBe(before);
  });
});
