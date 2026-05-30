import { PrimaryNav } from "./PrimaryNav";
import { render, screen } from "../../test/utils/render";

// PrimaryNav is a client component that reads the active route from
// `usePathname`. Mock `next/navigation` so each test can control the path
// and assert the active-link treatment (`is-active` class).
const usePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

// en.json: nav.tools = "TOOLS", nav.projects = "PROJECTS", nav.about = "ABOUT".
describe("PrimaryNav", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
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
