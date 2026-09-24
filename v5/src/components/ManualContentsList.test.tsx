import { render, screen, userEvent, within } from "../../test/utils/render";
import { toolWithLinks } from "../../test/fixtures/catalog";
import { DetailShell } from "./DetailShell";
import { ManualContentsList, MAX_ENTRIES } from "./ManualContentsList";

/**
 * The tool page's manual **Contents** (manual text spec §6): a collapsed
 * list under the manual's link, each chapter opening the stored PDF at its
 * page.
 */

const PDF = "https://example.com/form4-manual.pdf";
const OUTLINE = [
  { title: "Safety", page: 3, level: 1 },
  { title: "Laser safety", page: 4, level: 2 },
  { title: "Class 4 notes", page: 4, level: 3 },
  { title: "Specifications", page: 12, level: 1 },
];

describe("ManualContentsList", () => {
  it("is collapsed until opened, and links each chapter to its page of the PDF", async () => {
    const { container } = render(<ManualContentsList href={PDF} outline={OUTLINE} />);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await userEvent.click(screen.getByText("Contents"));
    expect(details.open).toBe(true);

    const links = within(details).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`${PDF}#page=3`, `${PDF}#page=4`, `${PDF}#page=12`]);
    expect(links[0]).toHaveTextContent("Safety");
    expect(links[0]).toHaveTextContent("p. 3");
    expect(links[0]).toHaveAttribute("target", "_blank");
    // Level 3 is left out: a table of contents, not the index.
    expect(within(details).queryByText("Class 4 notes")).toBeNull();
  });

  it("caps the list, and renders nothing for an outline with nothing to show", () => {
    const long = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => ({ title: `Chapter ${i}`, page: i + 1, level: 1 }));
    const { container, unmount } = render(<ManualContentsList href={PDF} outline={long} />);
    expect(container.querySelectorAll("li")).toHaveLength(MAX_ENTRIES);
    unmount();
    const empty = render(<ManualContentsList href={PDF} outline={[{ title: "Deep", page: 1, level: 3 }]} />);
    expect(empty.container.querySelector("details")).toBeNull();
  });
});

describe("DetailShell with manual contents", () => {
  it("puts the contents under the link they belong to, and nowhere else", () => {
    const { container } = render(<DetailShell tool={toolWithLinks} manualContents={[{ href: PDF, outline: OUTLINE }]} />);
    const lists = container.querySelectorAll(".td-doc-contents");
    expect(lists).toHaveLength(1);
    expect(lists[0].previousElementSibling?.getAttribute("href")).toBe(PDF);
  });

  it("shows no contents without any", () => {
    const { container } = render(<DetailShell tool={toolWithLinks} />);
    expect(container.querySelector(".td-doc-contents")).toBeNull();
  });
});
