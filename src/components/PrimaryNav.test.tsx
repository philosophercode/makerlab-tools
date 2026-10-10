import { waitForElementToBeRemoved } from "@testing-library/react";
import { PrimaryNav } from "./PrimaryNav";
import { act, render, screen, userEvent, within } from "../../test/utils/render";
import type { ClientIdentity, SignInStart } from "../lib/auth/sign-in-client";

// PrimaryNav is a client component that reads the active route from
// `usePathname`. Mock `next/navigation` so each test can control the path
// and assert the active-link treatment (`is-active` class).
const usePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

// The sign-in control resolves the current identity from `/api/identity` after
// mount and hands sign-in / sign-out back to the browser. Mock the three
// network-touching helpers (the pure ones — `isSignedIn`, `firstNameOf` — stay
// real, since the header's job is to render what they derive). Their own
// behaviour is covered in `lib/auth/sign-in-client.test.ts`.
const fetchIdentity = vi.fn<() => Promise<ClientIdentity | null>>(async () => null);
const startGoogleSignIn = vi.fn<(callbackURL: string) => Promise<SignInStart>>(
  async () => "started"
);
const signOutAndReload = vi.fn(async () => {});

vi.mock("../lib/auth/sign-in-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/sign-in-client")>();
  return {
    ...actual,
    fetchIdentity: () => fetchIdentity(),
    startGoogleSignIn: (callbackURL: string) => startGoogleSignIn(callbackURL),
    signOutAndReload: () => signOutAndReload(),
  };
});

// en.json: nav.tools = "TOOLS", nav.projects = "PROJECTS", nav.about = "ABOUT".
describe("PrimaryNav", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
    startGoogleSignIn.mockClear();
    signOutAndReload.mockClear();
  });

  it("renders the three primary nav links with correct hrefs", () => {
    render(<PrimaryNav />);

    const tools = screen.getByRole("link", { name: "TOOLS" });
    const projects = screen.getByRole("link", { name: "PROJECTS" });
    const about = screen.getByRole("link", { name: "ABOUT" });

    expect(tools).toHaveAttribute("href", "/");
    expect(projects).toHaveAttribute("href", "/projects");
    expect(about).toHaveAttribute("href", "/about");
  });

  it("labels the nav landmark from the translation catalog", () => {
    render(<PrimaryNav />);
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" })
    ).toBeInTheDocument();
  });

  it("marks the Tools link active on the home route", () => {
    usePathname.mockReturnValue("/");
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: "TOOLS" })).toHaveClass("is-active");
    expect(screen.getByRole("link", { name: "PROJECTS" })).not.toHaveClass(
      "is-active"
    );
    expect(screen.getByRole("link", { name: "ABOUT" })).not.toHaveClass(
      "is-active"
    );
  });

  it("treats any /tools/* path as the active Tools link", () => {
    usePathname.mockReturnValue("/tools/form-4");
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: "TOOLS" })).toHaveClass("is-active");
    expect(screen.getByRole("link", { name: "PROJECTS" })).not.toHaveClass(
      "is-active"
    );
  });

  it("marks the Projects link active on /projects routes", () => {
    usePathname.mockReturnValue("/projects/123");
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: "PROJECTS" })).toHaveClass(
      "is-active"
    );
    expect(screen.getByRole("link", { name: "TOOLS" })).not.toHaveClass(
      "is-active"
    );
  });

  it("marks the About link active on /about routes", () => {
    usePathname.mockReturnValue("/about");
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: "ABOUT" })).toHaveClass("is-active");
    expect(screen.getByRole("link", { name: "TOOLS" })).not.toHaveClass(
      "is-active"
    );
  });

  it("falls back to '/' (Tools active) when usePathname returns null", () => {
    // The component does `usePathname() || "/"`.
    usePathname.mockReturnValue(null as unknown as string);
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: "TOOLS" })).toHaveClass("is-active");
  });
});

// en.json: nav.signIn = "SIGN IN", nav.signedInAria = "Signed in as {name}".
// Signed-in controls live in the profile menu; its own behaviour is covered in
// ProfileMenu.test.tsx. These tests cover which control the bar shows.
describe("PrimaryNav — sign-in control", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
    startGoogleSignIn.mockClear();
    signOutAndReload.mockClear();
  });

  it("offers sign-in to an anonymous visitor", async () => {
    render(<PrimaryNav />);

    expect(
      await screen.findByRole("button", {
        name: "Sign in with your Cornell Tech account",
      })
    ).toHaveTextContent("SIGN IN");
    expect(
      screen.queryByRole("button", { name: /Signed in as/ })
    ).not.toBeInTheDocument();
  });

  it("keeps the catalog links available while anonymous — sign-in gates nothing", async () => {
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: /Sign in/ });
    expect(screen.getByRole("link", { name: "TOOLS" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "PROJECTS" })).toBeInTheDocument();
  });

  it("stays anonymous when the identity endpoint cannot answer", async () => {
    fetchIdentity.mockResolvedValue(null);
    render(<PrimaryNav />);

    expect(
      await screen.findByRole("button", { name: /Sign in/ })
    ).toBeInTheDocument();
  });

  it("replaces sign-in with the profile control once signed in", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);

    const profile = await screen.findByRole("button", { name: "Signed in as Ada" });
    expect(profile).toHaveAttribute("aria-haspopup", "menu");
    expect(profile).toHaveTextContent("Ada");
    expect(
      screen.queryByRole("button", { name: /Sign in/ })
    ).not.toBeInTheDocument();
    // First name only in the bar — the full name is in the menu.
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("shows the Google photo in the profile control", async () => {
    fetchIdentity.mockResolvedValue({
      role: "user",
      name: "Ada Lovelace",
      image: "https://lh3.googleusercontent.com/a/ada",
    });
    const { container } = render(<PrimaryNav />);

    await screen.findByRole("button", { name: "Signed in as Ada" });
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/ada");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("still offers the profile control when Google supplied no display name", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: null });
    render(<PrimaryNav />);

    expect(
      await screen.findByRole("button", { name: "Account menu" })
    ).toBeInTheDocument();
  });

  it("starts sign-in from the page the visitor is on, not from /", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/tools/form-4");
    render(<PrimaryNav />);

    await user.click(await screen.findByRole("button", { name: /Sign in/ }));

    expect(startGoogleSignIn).toHaveBeenCalledWith("/tools/form-4");
  });

  it("re-enables the control when sign-in could not start", async () => {
    const user = userEvent.setup();
    startGoogleSignIn.mockResolvedValue("failed");
    render(<PrimaryNav />);

    const button = await screen.findByRole("button", { name: /Sign in/ });
    await user.click(button);

    expect(button).not.toBeDisabled();
  });

  it("says so, beside the control, when this deployment has no sign-in set up", async () => {
    const user = userEvent.setup();
    startGoogleSignIn.mockResolvedValue("unconfigured");
    render(<PrimaryNav />);

    await user.click(await screen.findByRole("button", { name: /Sign in/ }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Sign-in isn't set up on this deployment yet."
    );
  });

  it("says the attempt failed when the request did, and clears the notice on the next try", async () => {
    const user = userEvent.setup();
    startGoogleSignIn.mockResolvedValue("failed");
    render(<PrimaryNav />);

    const button = await screen.findByRole("button", { name: /Sign in/ });
    await user.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't start sign-in. Try again.");

    // A retry that leaves for Google renders no notice at all.
    startGoogleSignIn.mockResolvedValue("started");
    await user.click(button);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows no notice before anyone has tried", async () => {
    render(<PrimaryNav />);
    await screen.findByRole("button", { name: /Sign in/ });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("lets the notice go after its duration instead of keeping it in the header", async () => {
    const user = userEvent.setup();
    startGoogleSignIn.mockResolvedValue("unconfigured");
    render(<PrimaryNav noticeDurationMs={40} />);

    await user.click(await screen.findByRole("button", { name: /Sign in/ }));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveStyle({ animationDuration: "40ms" });

    await waitForElementToBeRemoved(() => screen.queryByRole("status"));
  });
});

// Floor map spike (spec 2026-09-25, open question): MAP joins the links.
// Isaac, 2026-10-07 (identity spec amendment "ADMIN in the bar"): the bar
// holds TOOLS, MAP, PROJECTS, ABOUT, then ADMIN for those who can reach
// /admin, and the profile control (or SIGN IN) — nothing else. REPORT left
// the bar (the footer, the tool page and the chat keep reporting); Add
// equipment and Sign out are in the profile menu; Refresh is on /admin.
describe("PrimaryNav — what the bar holds", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
  });

  it.each([
    ["admin", "Niti Parikh", "Niti"],
    ["super_admin", "Isaac Steinberg", "Isaac"],
  ] as const)("shows the links, ADMIN and the profile control to %s", async (role, name, first) => {
    fetchIdentity.mockResolvedValue({ role, name });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: `Signed in as ${first}` });

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "TOOLS",
      "MAP",
      "PROJECTS",
      "ABOUT",
      "ADMIN",
    ]);
    expect(screen.getByRole("link", { name: "ADMIN" })).toHaveAttribute("href", "/admin");
    // MENU is in the DOM everywhere and drawn only on a phone and a short viewport (CSS).
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)
    ).toEqual(["MENU", `Signed in as ${first}`]);
  });

  it("gives a signed-in student the links and the profile control, and no ADMIN", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: "Signed in as Ada" });
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "TOOLS",
      "MAP",
      "PROJECTS",
      "ABOUT",
    ]);
    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)
    ).toEqual(["MENU", "Signed in as Ada"]);
  });

  it("shows only the links and Sign in to an anonymous visitor — no Report, no Admin", async () => {
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: /Sign in/ });
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["MENU", "SIGN IN"]);
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ADMIN" })).not.toBeInTheDocument();
  });

  it("marks ADMIN as the current page anywhere under /admin, colour and underline only", async () => {
    usePathname.mockReturnValue("/admin/maintenance");
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    const admin = await screen.findByRole("link", { name: "ADMIN" });
    expect(admin).toHaveClass("primary-nav-admin", "is-active");
    expect(screen.getByRole("link", { name: "TOOLS" })).not.toHaveClass("is-active");
  });

  it("does not mark ADMIN elsewhere", async () => {
    usePathname.mockReturnValue("/map");
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    expect(await screen.findByRole("link", { name: "ADMIN" })).not.toHaveClass("is-active");
    expect(screen.getByRole("link", { name: "MAP" })).toHaveClass("is-active");
  });

  it("keeps Add, Refresh and Sign out out of the bar until the menu opens", async () => {
    fetchIdentity.mockResolvedValue({ role: "super_admin", name: "Isaac Steinberg" });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: "Signed in as Isaac" });
    expect(screen.queryByRole("button", { name: /Add new equipment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SIGN OUT" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the profile menu from the bar, with the entries the role holds and no Admin", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    await user.click(await screen.findByRole("button", { name: "Signed in as Niti" }));

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["ADD EQUIPMENT", "ACCOUNT", "CONNECT AI ASSISTANT (MCP)", "SIGN OUT"]);
  });

  it("offers development-only sign-in only when the server says every guard passed", async () => {
    usePathname.mockReturnValue("/tools/form-4");
    fetchIdentity.mockResolvedValue({ role: "anonymous", name: null, devSignIn: true });
    render(<PrimaryNav />);

    const link = await screen.findByRole("link", { name: "Sign in as (dev)" });
    expect(link).toHaveAttribute("href", "/api/dev/sign-in?next=%2Ftools%2Fform-4");
  });

  it("never shows the development-only link without the server's hint", async () => {
    fetchIdentity.mockResolvedValue({ role: "anonymous", name: null });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: /Sign in with your/ });
    expect(screen.queryByRole("link", { name: "Sign in as (dev)" })).not.toBeInTheDocument();
  });
});

// The short bar (a phone on its side) and the phone bar (below sm), DESIGN.md
// §8.12: the links (and ADMIN, for those who can reach /admin) sit behind MENU,
// a disclosure button. CSS decides where MENU is drawn; these tests cover what
// it does — jsdom applies no stylesheet.
describe("PrimaryNav — the short bar's MENU", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
  });

  const menuButton = () => screen.getByRole("button", { name: "MENU" });
  const panel = () => document.getElementById(menuButton().getAttribute("aria-controls")!)!;

  it("is a disclosure button naming the panel that holds the links", () => {
    render(<PrimaryNav />);

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).not.toHaveAttribute("aria-haspopup");
    expect(panel()).not.toBeNull();
    expect(panel()).not.toHaveAttribute("data-open");
    expect(Array.from(panel().children).map((child) => child.textContent)).toEqual([
      "TOOLS",
      "MAP",
      "PROJECTS",
      "ABOUT",
    ]);
  });

  it("holds ADMIN too, last, for someone who can reach /admin", async () => {
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    await screen.findByRole("link", { name: "ADMIN" });
    expect(Array.from(panel().children).map((child) => child.textContent)).toEqual([
      "TOOLS",
      "MAP",
      "PROJECTS",
      "ABOUT",
      "ADMIN",
    ]);
  });

  it("opens and closes from the button", async () => {
    const user = userEvent.setup();
    render(<PrimaryNav />);

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(panel()).toHaveAttribute("data-open", "true");

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(panel()).not.toHaveAttribute("data-open");
  });

  it("walks the links with Tab, and Escape closes it with focus back on the button", async () => {
    const user = userEvent.setup();
    render(<PrimaryNav />);

    menuButton().focus();
    await user.keyboard("{Enter}");
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");

    await user.tab();
    expect(screen.getByRole("link", { name: "TOOLS" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "MAP" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });

  it("closes when a link is followed", async () => {
    const user = userEvent.setup();
    render(<PrimaryNav />);
    // Keep jsdom from navigating; the link's own handler still runs.
    const stop = (event: Event) => event.preventDefault();
    window.addEventListener("click", stop, { capture: true });

    await user.click(menuButton());
    await user.click(screen.getByRole("link", { name: "PROJECTS" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");

    window.removeEventListener("click", stop, { capture: true });
  });

  it("closes when ADMIN is followed", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "super_admin", name: "Isaac Steinberg" });
    render(<PrimaryNav />);
    const stop = (event: Event) => event.preventDefault();
    window.addEventListener("click", stop, { capture: true });

    await user.click(menuButton());
    await user.click(await screen.findByRole("link", { name: "ADMIN" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");

    window.removeEventListener("click", stop, { capture: true });
  });

  it("closes on a press outside, and when focus moves to anything else", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PrimaryNav />
        <p>Page</p>
        <button type="button">Elsewhere</button>
      </>
    );

    await user.click(menuButton());
    await user.click(screen.getByText("Page"));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");

    await user.click(menuButton());
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("closes when the viewport stops being one that draws MENU — a window widened past a phone's", async () => {
    const listeners = new Set<() => void>();
    const list = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    const matchMedia = vi.fn(() => list);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
    try {
      const user = userEvent.setup();
      render(<PrimaryNav />);

      await user.click(menuButton());
      // A phone on its side, or below sm (the phone bar).
      expect(matchMedia).toHaveBeenCalledWith("(orientation: landscape) and (max-height: 500px), (max-width: 639.98px)");
      expect(listeners.size).toBe(1);

      list.matches = false;
      act(() => listeners.forEach((fn) => fn()));
      expect(menuButton()).toHaveAttribute("aria-expanded", "false");
      expect(listeners.size).toBe(0);
    } finally {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });
});

// The phone bar (below sm, DESIGN.md §8.12, amendment "The phone bar"): MENU
// also holds what that bar has no room for — the account, or Sign in, then the
// language and theme controls `GlobalChrome` hands it. Drawn only while MENU is
// open, so the rest of the time each control exists once; CSS shows these rows
// on a phone only.
describe("PrimaryNav — the phone bar's MENU", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
    startGoogleSignIn.mockReset();
    startGoogleSignIn.mockResolvedValue("started");
    signOutAndReload.mockClear();
  });

  const menuButton = () => screen.getByRole("button", { name: "MENU" });
  const panel = () => document.getElementById(menuButton().getAttribute("aria-controls")!)!;

  it("holds Sign in and the preferences it is given, only while open", async () => {
    const user = userEvent.setup();
    render(<PrimaryNav menuPreferences={<button type="button">Preferences</button>} />);
    await screen.findByRole("button", { name: /Sign in with your/ });
    expect(screen.queryByRole("button", { name: "Preferences" })).not.toBeInTheDocument();

    await user.click(menuButton());
    const inMenu = within(panel());
    expect(inMenu.getByRole("button", { name: "Sign in with your Cornell Tech account" })).toBeInTheDocument();
    expect(inMenu.getByRole("button", { name: "Preferences" })).toBeInTheDocument();

    await user.click(menuButton());
    expect(screen.queryByRole("button", { name: "Preferences" })).not.toBeInTheDocument();
  });

  it("holds the account for someone signed in — who, the profile menu's entries and Sign out, as rows", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "super_admin", name: "Isaac Steinberg", email: "isaac@example.edu" });
    render(<PrimaryNav />);
    await screen.findByRole("button", { name: "Signed in as Isaac" });

    await user.click(menuButton());
    const inMenu = within(panel());
    expect(inMenu.getByText("Isaac Steinberg")).toBeInTheDocument();
    expect(inMenu.getByText("isaac@example.edu")).toBeInTheDocument();
    expect(inMenu.getByRole("button", { name: "ADD EQUIPMENT" })).toBeInTheDocument();
    expect(inMenu.getByRole("link", { name: "ACCOUNT" })).toHaveAttribute("href", "/account");
    expect(inMenu.getByRole("link", { name: "CONNECT AI ASSISTANT (MCP)" })).toHaveAttribute("href", "/account/tokens");
    // A disclosure's rows, which Tab walks — not a second `menu`.
    expect(inMenu.queryByRole("menu")).not.toBeInTheDocument();
    expect(inMenu.queryAllByRole("menuitem")).toHaveLength(0);

    await user.click(inMenu.getByRole("button", { name: "SIGN OUT" }));
    expect(signOutAndReload).toHaveBeenCalledTimes(1);
  });

  it("gives a student no Add equipment", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);
    await screen.findByRole("button", { name: "Signed in as Ada" });

    await user.click(menuButton());
    expect(within(panel()).queryByRole("button", { name: "ADD EQUIPMENT" })).not.toBeInTheDocument();
    expect(within(panel()).getByRole("link", { name: "ACCOUNT" })).toBeInTheDocument();
  });

  it("closes when an account row is followed", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);
    await screen.findByRole("button", { name: "Signed in as Ada" });
    const stop = (event: Event) => event.preventDefault();
    window.addEventListener("click", stop, { capture: true });

    await user.click(menuButton());
    await user.click(within(panel()).getByRole("link", { name: "ACCOUNT" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");

    window.removeEventListener("click", stop, { capture: true });
  });

  it("closes, focus back on MENU, when Sign in from it cannot start — so the notice under the bar shows", async () => {
    const user = userEvent.setup();
    startGoogleSignIn.mockResolvedValue("unconfigured");
    render(<PrimaryNav />);
    await screen.findByRole("button", { name: /Sign in with your/ });

    await user.click(menuButton());
    await user.click(within(panel()).getByRole("button", { name: /Sign in with your/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sign-in isn't set up on this deployment yet.");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });
});
