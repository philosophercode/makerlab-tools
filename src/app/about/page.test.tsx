/**
 * `/about` (identity spec 2026-09-28 §6): about the MakerLAB first, in the
 * order of Cornell Tech's own MakerLAB page, then the projects, then this
 * site and its assistant, with links to the sources.
 */
import AboutPage, { metadata } from "./page";
import { render, screen, within } from "../../../test/utils/render";

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("/about", () => {
  it("is about the MakerLAB, with the site's name in the page title", () => {
    render(<AboutPage />);

    expect(screen.getByRole("heading", { level: 1, name: "The MakerLAB at Cornell Tech" })).toBeInTheDocument();
    expect(metadata.title).toBe("About");
  });

  it("shows the lab's official logo under the title, before the first section", () => {
    const { container } = render(<AboutPage />);

    const logo = container.querySelector('[data-slot="brand-logo"]');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("aria-hidden", "true");
    const firstSection = screen.getByRole("region", { name: "The MakerLAB" });
    expect(logo!.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("follows the official page's order, then About this project", () => {
    render(<AboutPage />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "The MakerLAB",
      "Visit",
      "People",
      "Community",
      "Learn more",
      "About this project",
      "Connect an AI assistant",
    ]);
  });

  it("says where the lab is and links the official page for hours and access", () => {
    render(<AboutPage />);

    const visit = section("Visit");
    expect(visit).toHaveTextContent("First floor, Tata Innovation Center");
    expect(visit).toHaveTextContent("2 West Loop Road, Roosevelt Island");
    expect(within(visit).getByRole("link", { name: "The MakerLAB on tech.cornell.edu" })).toHaveAttribute(
      "href",
      "https://tech.cornell.edu/research/makerlab/"
    );
  });

  it("names the people who run the lab, with their addresses", () => {
    render(<AboutPage />);

    const people = section("People");
    expect(people).toHaveTextContent("Niti Parikh");
    expect(people).toHaveTextContent("Director, Learning Spaces and MakerLABs");
    expect(people).toHaveTextContent("Luis Rodrigo Navarro");
    expect(within(people).getByRole("link", { name: "Email Niti Parikh" })).toHaveAttribute("href", "mailto:ntp27@cornell.edu");
  });

  it("has no separate Projects section (the gallery has its own page)", () => {
    render(<AboutPage />);

    expect(screen.queryByRole("heading", { level: 2, name: "Projects" })).toBeNull();
  });

  it("describes MakerLAB Tools and the assistant — operate, debug, create — and credits the team", () => {
    render(<AboutPage />);

    const project = section("About this project");
    expect(project).toHaveTextContent("MakerLAB Tools is the lab's digital guide");
    expect(project).toHaveTextContent("MakerLAB AI");
    for (const mode of ["Operate", "Debug", "Create"]) expect(within(project).getByText(mode)).toBeInTheDocument();
    expect(project).toHaveTextContent(
      "Built by Isaac Steinberg (Tech Lead, Johnson Cornell Tech MBA '26) for the MakerLAB, which Niti Parikh (Director) and Luis Rodrigo Navarro (Assistant Director) run."
    );
  });

  it("links the product page and the quick start from About this project", () => {
    render(<AboutPage />);

    const project = section("About this project");
    expect(within(project).getByRole("link", { name: "What MakerLAB Tools can do" })).toHaveAttribute("href", "/product");
    expect(within(project).getByRole("link", { name: "Quick start guide" })).toHaveAttribute("href", "/product/quick-start");
    expect(within(project).getByRole("link", { name: "What MakerLAB AI can and can't do" })).toHaveAttribute("href", "/assistant");
  });

  it("keeps the MCP pointer and the way back to the tools", () => {
    render(<AboutPage />);

    expect(screen.getByRole("link", { name: "See the MCP server and its tools" })).toHaveAttribute("href", "/mcp");
    expect(screen.getByRole("link", { name: "Browse tools" })).toHaveAttribute("href", "/");
  });
});
