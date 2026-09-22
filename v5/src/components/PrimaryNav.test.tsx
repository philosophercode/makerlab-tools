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

// en.json: nav.signIn = "SIGN IN", nav.signOut = "SIGN OUT".
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
      screen.queryByRole("button", { name: "SIGN OUT" })
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

  it("shows the first name and a sign-out control once signed in", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "SIGN OUT" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Sign in/ })
    ).not.toBeInTheDocument();
    // First name only — the surname is not shown.
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("names the signed-in state for screen readers", async () => {
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    expect(await screen.findByLabelText("Signed in as Niti")).toHaveTextContent(
      "Niti"
    );
  });

  it("renders no avatar image in either state (technical-schematic system)", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    const { container } = render(<PrimaryNav />);

    await screen.findByText("Ada");
    expect(container.querySelector("img")).toBeNull();
  });

  it("still offers sign-out when Google supplied no display name", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: null });
    render(<PrimaryNav />);

    expect(
      await screen.findByRole("button", { name: "SIGN OUT" })
    ).toBeInTheDocument();
  });

  it("starts sign-in from the page the visitor is on, not from /", async () => {
    const user = userEvent.setup();
    usePathname.mockReturnValue("/tools/form-4");
    render(<PrimaryNav />);

    await user.click(await screen.findByRole("button", { name: /Sign in/ }));

    expect(startGoogleSignIn).toHaveBeenCalledWith("/tools/form-4");
  });

  it("signs out through the shared helper", async () => {
    const user = userEvent.setup();
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);

    await user.click(await screen.findByRole("button", { name: "SIGN OUT" }));

    expect(signOutAndReload).toHaveBeenCalledTimes(1);
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

// The header is where the staff refresh control lives (ops hardening spec §3.2),
// because it reuses the identity this component already resolved. Its own
// behaviour is covered in RefreshCatalogButton.test.tsx.
describe("PrimaryNav — staff refresh control", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
  });

  it("offers the refresh control to an admin", async () => {
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Niti Parikh" });
    render(<PrimaryNav />);

    expect(
      await screen.findByRole("button", { name: /Refresh the/ })
    ).toBeInTheDocument();
  });

  it("offers the refresh control to a super admin", async () => {
    fetchIdentity.mockResolvedValue({ role: "super_admin", name: "Isaac Steinberg" });
    render(<PrimaryNav />);

    expect(
      await screen.findByRole("button", { name: /Refresh the/ })
    ).toBeInTheDocument();
  });

  it("does not show it to an ordinary signed-in user", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: "SIGN OUT" });
    expect(
      screen.queryByRole("button", { name: /Refresh the/ })
    ).not.toBeInTheDocument();
  });

  it("does not show it to an anonymous visitor", async () => {
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: /Sign in/ });
    expect(
      screen.queryByRole("button", { name: /Refresh the/ })
    ).not.toBeInTheDocument();
  });
});

// en.json: nav.add = "ADD", nav.addAria = "Add new equipment to the inventory".
// Adding equipment needs `tools.add` (spec §3.5); the chat enforces it
// server-side, so this only asserts the entry point's visibility.
describe("PrimaryNav — add equipment", () => {
  const ADD = "Add new equipment to the inventory";

  beforeEach(() => {
    usePathname.mockReturnValue("/");
    fetchIdentity.mockClear();
    fetchIdentity.mockResolvedValue(null);
  });

  it.each([
    ["admin", "Niti Parikh"],
    ["super_admin", "Isaac Steinberg"],
  ] as const)("offers it to %s", async (role, name) => {
    fetchIdentity.mockResolvedValue({ role, name });
    render(<PrimaryNav />);

    expect(await screen.findByRole("button", { name: ADD })).toHaveTextContent(
      "ADD"
    );
  });

  it("does not offer it to an ordinary signed-in user", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: "Ada Lovelace" });
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: "SIGN OUT" });
    expect(screen.queryByRole("button", { name: ADD })).not.toBeInTheDocument();
  });

  it("does not offer it to an anonymous visitor", async () => {
    render(<PrimaryNav />);

    await screen.findByRole("button", { name: /Sign in/ });
    expect(screen.queryByRole("button", { name: ADD })).not.toBeInTheDocument();
  });
});
