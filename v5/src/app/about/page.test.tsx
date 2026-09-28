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
    expect(metadata.title).toBe("About — MakerLAB Tools");
  });

  it("follows the official page's order, then Projects and About this project", () => {
    render(<AboutPage />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "The MakerLAB",
      "Visit",
      "People",
      "Community",
      "Learn more",
      "Projects",
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

  it("points to the projects gallery", () => {
    render(<AboutPage />);

    expect(within(section("Projects")).getByRole("link", { name: "See the projects" })).toHaveAttribute("href", "/projects");
  });

  it("describes MakerLAB Tools and the assistant — operate, debug, create — and credits the team", () => {
    render(<AboutPage />);

    const project = section("About this project");
    expect(project).toHaveTextContent("MakerLAB Tools is the lab's digital guide");
    expect(project).toHaveTextContent("MakerLAB Assistant");
    for (const mode of ["Operate", "Debug", "Create"]) expect(within(project).getByText(mode)).toBeInTheDocument();
    expect(project).toHaveTextContent(
      "Built by Isaac Steinberg (Tech Lead, Johnson Cornell Tech MBA '26) with Niti Parikh (Director) and Luis Rodrigo Navarro (Assistant Director)."
    );
  });

  it("keeps the MCP pointer and the way back to the tools", () => {
    render(<AboutPage />);

    expect(screen.getByRole("link", { name: "See the MCP server and its tools" })).toHaveAttribute("href", "/mcp");
    expect(screen.getByRole("link", { name: "Browse tools" })).toHaveAttribute("href", "/");
  });
});
