import { GlobalChrome } from "./GlobalChrome";
import type { CatalogStats } from "./catalog-types";
import { render, screen, userEvent, within } from "../../test/utils/render";
import { siteConfig } from "../lib/site-config";
import type { ClientIdentity } from "../lib/auth/sign-in-client";

// GlobalChrome is a plain (non-async) function component, so the custom render
// drives it directly. It composes PrimaryNav (usePathname) and LanguageSelector
// (useRouter + the `changeLocale` server action) — both are mocked here so the
// child controls mount without a live router or server-action runtime.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("../i18n/actions", () => ({
  changeLocale: vi.fn(async () => {}),
}));

// The header asks `/api/identity` after mount; each test decides the answer.
const fetchIdentity = vi.fn<() => Promise<ClientIdentity | null>>(async () => null);
vi.mock("../lib/auth/sign-in-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/sign-in-client")>();
  return { ...actual, fetchIdentity: () => fetchIdentity() };
});

beforeEach(() => {
  fetchIdentity.mockReset();
  fetchIdentity.mockResolvedValue(null);
});

const stats: CatalogStats = {
  toolsInInventory: 42,
  labHours: "Mon–Fri 9am–9pm",
};

describe("GlobalChrome", () => {
  it("renders the lockup as MakerLAB AI: the wordmark, then AI, linking home", () => {
    render(<GlobalChrome stats={stats} />);

    const brand = screen.getByRole("link", { name: "MakerLAB AI" });
    expect(brand).toHaveAttribute("href", "/");
    expect(brand).toHaveClass("brand-lockup");
    // No site name or tagline beside it any more (owner decision 2026-10-07).
    expect(brand).not.toHaveTextContent("MakerLAB Tools");
    expect(brand).not.toHaveTextContent(siteConfig.tagline);
    expect(brand.querySelector(".brand-ai")).toHaveTextContent("AI");
    // The old lockup is gone.
    expect(screen.queryByText("// CORNELL TECH")).not.toBeInTheDocument();
  });

  it("draws the wordmark from the official lettering, as decoration", () => {
    render(<GlobalChrome stats={stats} />);

    const brand = screen.getByRole("link", { name: "MakerLAB AI" });
    const wordmark = brand.querySelector('[data-slot="brand-wordmark"]') as HTMLElement;
    expect(wordmark).not.toBeNull();
    expect(wordmark).toHaveAttribute("aria-hidden", "true");
    expect(siteConfig.wordmark).toBe("/brand/makerlab-wordmark-official.svg");
    expect(wordmark.style.maskImage || wordmark.getAttribute("style")).toContain("/brand/makerlab-wordmark-official.svg");
  });

  it("renders PrimaryNav with its links", () => {
    render(<GlobalChrome stats={stats} />);

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TOOLS" })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.getByRole("link", { name: "PROJECTS" })).toHaveAttribute(
      "href",
      "/projects"
    );
    expect(screen.getByRole("link", { name: "ABOUT" })).toHaveAttribute(
      "href",
      "/about"
    );
  });

  it("shows the catalog stats: tools-in-inventory count and lab hours", () => {
    render(<GlobalChrome stats={stats} />);

    // en.json: status.toolsInInventory = "{count} TOOLS IN INVENTORY"
    expect(screen.getByText("42 TOOLS IN INVENTORY")).toBeInTheDocument();
    expect(screen.getByText("Mon–Fri 9am–9pm")).toBeInTheDocument();
  });

  it("reflects an updated tools-in-inventory count", () => {
    render(
      <GlobalChrome stats={{ toolsInInventory: 7, labHours: "24/7" }} />
    );
    expect(screen.getByText("7 TOOLS IN INVENTORY")).toBeInTheDocument();
    expect(screen.getByText("24/7")).toBeInTheDocument();
  });

  it("mounts the utility controls (LanguageSelector + ThemeToggle) without error", () => {
    render(<GlobalChrome stats={stats} />);

    // The actions region is a labelled <div> (no implicit role).
    expect(screen.getByLabelText("Utility controls")).toBeInTheDocument();
    // LanguageSelector renders a <select> with all 12 locales.
    const select = screen.getByRole("combobox", { name: "Select language" });
    expect(select).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(12);
    // ThemeToggle renders the cycle button.
    expect(
      screen.getByRole("button", {
        name: "Cycle color theme (system → light → dark)",
      })
    ).toBeInTheDocument();
  });

  // The phone bar (DESIGN.md §8.12, amendment "The phone bar"): the language
  // and theme also sit in MENU, as rows, while it is open.
  it("puts the language and theme in MENU as rows while it is open, and in the bar once otherwise", async () => {
    const user = userEvent.setup();
    render(<GlobalChrome stats={stats} />);
    expect(screen.getAllByRole("combobox", { name: "Select language" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "MENU" }));
    const panel = document.getElementById(screen.getByRole("button", { name: "MENU" }).getAttribute("aria-controls")!)!;
    const inMenu = within(panel);
    expect(inMenu.getByRole("combobox", { name: "Select language" })).toHaveValue("en");
    expect(inMenu.getByText("English", { selector: ".lang-select-current" })).toBeInTheDocument();
    expect(inMenu.getByRole("button", { name: "Cycle color theme (system → light → dark)" })).toHaveTextContent("Theme");
  });

  it("labels the lab-status strip from the catalog", () => {
    render(<GlobalChrome stats={stats} />);
    expect(screen.getByLabelText("Lab status")).toBeInTheDocument();
  });

  // Isaac, 2026-10-07: links, ADMIN for those who can reach /admin, then the
  // profile control or SIGN IN. REPORT left the bar.
  it("keeps the header to links and Sign in for a visitor", async () => {
    render(<GlobalChrome stats={stats} />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(await screen.findByRole("button", { name: /Sign in/ })).toBeInTheDocument();
    // TOOLS, MAP (floor map spike), PROJECTS, ABOUT.
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Report a problem" })).not.toBeInTheDocument();
  });

  it("gives a director ADMIN and the profile control, and nothing else new in the bar", async () => {
    fetchIdentity.mockResolvedValue({
      role: "super_admin",
      name: "Isaac Steinberg",
      email: "isaac@cornell.edu",
      image: "https://lh3.googleusercontent.com/a/isaac",
    });
    render(<GlobalChrome stats={stats} />);

    expect(
      await screen.findByRole("button", { name: "Signed in as Isaac" })
    ).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByRole("link", { name: "ADMIN" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("button", { name: /Add new equipment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh catalog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SIGN OUT" })).not.toBeInTheDocument();
  });
});
