import { waitForElementToBeRemoved } from "@testing-library/react";
import { PrimaryNav } from "./PrimaryNav";
import { render, screen, userEvent } from "../../test/utils/render";
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

// Isaac, 2026-09-23: the bar holds TOOLS, PROJECTS, ABOUT, REPORT and the
// profile control (or SIGN IN) — nothing else, whatever the role. Admin, Add
// equipment and Sign out are in the profile menu; Refresh is on /admin.
describe("PrimaryNav — what the bar holds", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
  });

  it.each([
    ["user", "Ada Lovelace", "Ada"],
    ["admin", "Niti Parikh", "Niti"],
    ["super_admin", "Isaac Steinberg", "Isaac"],
  ] as const)("shows only links, Report and the profile control to %s", async (role, name, first) => {
    fetchIdentity.mockResolvedValue({ role, name });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: `Signed in as ${first}` });

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "TOOLS",
      "PROJECTS",
      "ABOUT",
    ]);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Report a problem",
      `Signed in as ${first}`,
    ]);
  });

  it("shows only links, Report and Sign in to an anonymous visitor", async () => {
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: /Sign in/ });
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "REPORT",
      "SIGN IN",
    ]);
  });

  it("keeps Admin, Add, Refresh and Sign out out of the bar until the menu opens", async () => {
    fetchIdentity.mockResolvedValue({ role: "super_admin", name: "Isaac Steinberg" });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: "Signed in as Isaac" });
    expect(screen.queryByRole("link", { name: "ADMIN" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add new equipment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SIGN OUT" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the profile menu from the bar, with the entries the role holds", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    await user.click(await screen.findByRole("button", { name: "Signed in as Niti" }));

    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["ADMIN", "ADD EQUIPMENT", "CONNECT AN AI ASSISTANT", "SIGN OUT"]);
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
