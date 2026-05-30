import { GlobalChrome } from "./GlobalChrome";
import type { CatalogStats } from "./catalog-types";
import { render, screen } from "../../test/utils/render";
import { siteConfig } from "../lib/site-config";

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

const stats: CatalogStats = {
  toolsInInventory: 42,
  labHours: "Mon–Fri 9am–9pm",
};

describe("GlobalChrome", () => {
  it("renders the brand lockup using siteConfig (default name) linking home", () => {
    render(<GlobalChrome stats={stats} />);

    // Default site name from site-config.ts (env unset).
    expect(siteConfig.name).toBe("MakerLab Tools");
    const brand = screen.getByRole("link", { name: /MakerLab Tools/ });
    expect(brand).toHaveAttribute("href", "/");
    expect(brand).toHaveClass("brand-lockup");
  });

  it("renders the brand tagline from the translation catalog", () => {
    render(<GlobalChrome stats={stats} />);
    // en.json: nav.brandTagline = "// CORNELL TECH"
    expect(screen.getByText("// CORNELL TECH")).toBeInTheDocument();
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

  it("labels the lab-status strip from the catalog", () => {
    render(<GlobalChrome stats={stats} />);
    expect(screen.getByLabelText("Lab status")).toBeInTheDocument();
  });
});
