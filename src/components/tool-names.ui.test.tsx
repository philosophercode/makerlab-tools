import { render, screen, userEvent, within } from "../../test/utils/render";
import { mockCatalog, toolWithLinks } from "../../test/fixtures/catalog";
import type { EditableTool } from "../lib/data/tools";
import { ToolFieldsForm } from "./admin/ToolFieldsForm";
import { DetailShell } from "./DetailShell";
import { GalleryShell } from "./GalleryShell";

/**
 * Where each of a tool's two names shows (tool display names spec 2026-09-24,
 * §6): the display name is the title everywhere, the official name a line
 * under it on the tool page, both are searchable, and the editor edits both.
 */

vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("the tool page", () => {
  it("titles the page with the display name and shows the official name under it", () => {
    render(<DetailShell tool={{ ...toolWithLinks, officialName: "Formlabs Form 4 Resin 3D Printer" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Form 4" })).toBeInTheDocument();
    expect(screen.getByText("Formlabs Form 4 Resin 3D Printer")).toHaveAttribute("data-slot", "official-name");
  });

  it("shows no subtitle when there is no official name, or it is the same name", () => {
    const { container, rerender } = render(<DetailShell tool={{ ...toolWithLinks, officialName: null }} />);
    expect(container.querySelector('[data-slot="official-name"]')).toBeNull();
    rerender(<DetailShell tool={{ ...toolWithLinks, officialName: "FORM-4" }} />);
    expect(container.querySelector('[data-slot="official-name"]')).toBeNull();
  });
});

describe("the gallery", () => {
  it("shows display names on the cards and finds a tool by its official name", async () => {
    const tools = mockCatalog.map((tool, i) => (i === 0 ? { ...tool, officialName: "Zorbex ZX-9000 Industrial Widget Press" } : tool));
    const user = userEvent.setup();
    render(<GalleryShell tools={tools} />);

    await user.type(screen.getByRole("searchbox", { name: "Search inventory" }), "Zorbex");
    const grid = screen.getByRole("region", { name: "Tool gallery" });
    const names = within(grid)
      .getAllByRole("link")
      .map((link) => within(link).getByRole("heading").textContent);
    expect(names).toEqual([tools[0].name]);
  });
});

describe("the tool editor", () => {
  function tool(overrides: Partial<EditableTool> = {}): EditableTool {
    return {
      id: "tool-1",
      slug: "festool-575267",
      name: "Festool 575267 Dust Extractor CT Midi Hepa",
      officialName: null,
      description: null,
      categoryId: null,
      locationId: null,
      materials: [],
      ppeRequired: [],
      tags: [],
      trainingRequired: false,
      useRestrictions: null,
      emergencyStop: null,
      notes: null,
      starterQuestions: [],
      revision: "1758000000.1",
      published: true,
      archivedAt: null,
      lastReviewedAt: null,
      lastReviewedBy: null,
      ...overrides,
    };
  }

  function renderForm(values = tool()) {
    const onSave = vi.fn();
    render(<ToolFieldsForm values={values} categories={[]} locations={[]} pending={false} onSave={onSave} />);
    return onSave;
  }

  it("edits both names, with the rules as hints, and sends only what changed", async () => {
    const onSave = renderForm();
    expect(screen.getByLabelText("Display name")).toHaveAccessibleDescription(/No part numbers/);
    expect(screen.getByLabelText("Official name")).toHaveAccessibleDescription(/model or part number/);

    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "Festool Dust Extractor");
    await userEvent.type(screen.getByLabelText("Official name"), "Festool 575267 Dust Extractor CT Midi Hepa");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Festool Dust Extractor",
      officialName: "Festool 575267 Dust Extractor CT Midi Hepa",
    });
  });

  it("says an edited display name is over the cap, and does not save it", async () => {
    const onSave = renderForm(tool({ name: "Festool Dust Extractor" }));
    await userEvent.type(screen.getByLabelText("Display name"), " CT Midi Hepa With Extra Words");
    expect(screen.getByText(/shorten it to 40 or fewer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("lets an untouched long imported name be saved beside other edits", async () => {
    const onSave = renderForm();
    await userEvent.type(screen.getByLabelText("Official name"), "Festool CT MIDI I");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(onSave).toHaveBeenCalledWith({ officialName: "Festool CT MIDI I" });
  });
});
