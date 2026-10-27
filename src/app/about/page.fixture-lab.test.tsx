/**
 * `/about` for another lab (lab config spec §10, amendment §12.5): with a
 * fixture config, the page shows the fixture's own words, in the visitor's
 * locale when the fixture gives it and in English when it does not, and
 * leaves out what the fixture leaves out.
 */
vi.mock("../../lib/lab/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/lab/config")>();
  const fixture = structuredClone(actual.lab);
  fixture.identity.labName = "Fab Lab";
  fixture.about = {
    title: { en: "The Fab Lab at Example University", es: "El Fab Lab de Example University" },
    lede: "Make almost anything.",
    body: ["A small shop with big machines."],
    where: "Room 12, Science Hall",
    hours: "Weekdays, 9 to 5.",
  };
  fixture.people = [{ name: "Ada Maker", title: "Lab Manager" }];
  fixture.photos = [];
  fixture.links = { more: [{ href: "https://example.edu/fablab", label: "The Fab Lab's page" }] };
  fixture.pages.product = false;
  return { ...actual, lab: fixture };
});

import AboutPage from "./page";
import { render, screen } from "../../../test/utils/render";

describe("/about with a fixture lab", () => {
  it("shows the fixture's words, and English where a locale has none", () => {
    render(<AboutPage />, { locale: "es" });
    expect(screen.getByRole("heading", { level: 1, name: "El Fab Lab de Example University" })).toBeInTheDocument();
    expect(screen.getByText("Make almost anything.")).toBeInTheDocument();
    expect(screen.getByText("Room 12, Science Hall")).toBeInTheDocument();
  });

  it("leaves out what the fixture leaves out", () => {
    const { container } = render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1, name: "The Fab Lab at Example University" })).toBeInTheDocument();
    expect(container.querySelector("img[src*='makerlab']")).toBeNull();
    expect(screen.queryByRole("region", { name: "Community" })).not.toBeInTheDocument();
    expect(screen.getByText("Lab Manager")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The Fab Lab's page" })).toHaveAttribute("href", "https://example.edu/fablab");
    expect(screen.queryByRole("link", { name: /quick start/i })).not.toBeInTheDocument();
  });
});
