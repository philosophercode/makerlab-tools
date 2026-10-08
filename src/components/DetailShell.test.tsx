import { render, screen, within } from "../../test/utils/render";
import { DetailShell } from "./DetailShell";
import {
  toolWithLinks,
  inUseTool,
  offlineTool,
} from "../../test/fixtures/catalog";

describe("DetailShell", () => {
  describe("with a rich tool (toolWithLinks)", () => {
    it("renders the tool name as the page heading", () => {
      render(<DetailShell tool={toolWithLinks} />);
      expect(
        screen.getByRole("heading", { level: 1, name: toolWithLinks.name })
      ).toBeInTheDocument();
    });

    it("renders the hero image from imageSrc", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      const img = container.querySelector('[data-slot="tool-hero"] img') as HTMLImageElement;
      expect(img).not.toBeNull();
      // next/image rewrites the src through the optimizer but the original
      // path is encoded in the URL — assert the original filename survives.
      expect(decodeURIComponent(img.src)).toContain(toolWithLinks.imageSrc);
    });

    it("renders the description text", () => {
      render(<DetailShell tool={toolWithLinks} />);
      expect(screen.getByText(toolWithLinks.description)).toBeInTheDocument();
    });

    it("says status, training and PPE as glyphs and words on one line", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      // status === "Available" — scope to the status line (the unit table
      // also shows "Available" for the available unit).
      const chipRow = container.querySelector('[data-slot="tool-status-line"]') as HTMLElement;
      expect(chipRow).toHaveAttribute("aria-label", "Tool status");
      expect(chipRow.querySelector('[data-glyph="ok"]')).not.toBeNull();
      expect(within(chipRow).getByText(/1 of 1 unit available/)).toBeInTheDocument();
      expect(chipRow).not.toBeNull();
      expect(within(chipRow).getByText("Available")).toBeInTheDocument();
      // trainingChip => "{level} training" => "Intermediate training"
      expect(
        within(chipRow).getByText(`${toolWithLinks.trainingLevel} training`)
      ).toBeInTheDocument();
    });

    it("shows the PPE-required chip and lists each PPE item", () => {
      render(<DetailShell tool={toolWithLinks} />);
      // "PPE Required" appears as both a chip and the safety section heading.
      expect(screen.getAllByText("PPE Required").length).toBeGreaterThanOrEqual(1);
      for (const item of toolWithLinks.ppe) {
        expect(screen.getByText(item)).toBeInTheDocument();
      }
    });

    it("lists materials (joined) once, in the specifications", () => {
      render(<DetailShell tool={toolWithLinks} />);
      const joined = toolWithLinks.materials.join(", ");
      // The "at a glance" card that repeated them is gone (phase 5a).
      expect(screen.getAllByText(joined)).toHaveLength(1);
    });

    it("renders category and location in the specifications list", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      const specs = container.querySelector('[data-slot="tool-specs"]') as HTMLElement;
      expect(specs.tagName).toBe("DL");
      const rowText = Array.from(specs.children).map((row) => (row.textContent || "").replace(/\s+/g, " ").trim());
      expect(rowText).toContain(`Category${toolWithLinks.category} › ${toolWithLinks.categorySub}`);
      expect(rowText).toContain(`Location${toolWithLinks.location} › ${toolWithLinks.zone}`);
    });

    it("links the category and the room to the gallery filtered by them", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      expect(container.querySelector('[data-slot="category-link"]')).toHaveAttribute(
        "href",
        `/?${new URLSearchParams({ category: toolWithLinks.category })}`
      );
      expect(container.querySelector('[data-slot="location-link"]')).toHaveAttribute(
        "href",
        `/?${new URLSearchParams({ location: toolWithLinks.location })}`
      );
    });

    it("renders each resource link with its href and label", () => {
      render(<DetailShell tool={toolWithLinks} />);
      for (const link of toolWithLinks.links) {
        const anchor = screen.getByRole("link", { name: new RegExp(link.label, "i") });
        expect(anchor).toHaveAttribute("href", link.href);
      }
    });

    it("marks a link whose manual the assistant can search, and only that one", () => {
      const [first, second] = toolWithLinks.links;
      const { container } = render(
        <DetailShell
          tool={toolWithLinks}
          manualContents={[
            { href: first.href, outline: [], searchable: true },
            ...(second ? [{ href: second.href, outline: [], searchable: false }] : []),
          ]}
        />
      );
      const marks = container.querySelectorAll('[data-slot="searchable-manual"]');
      expect(marks).toHaveLength(1);
      expect(screen.getByRole("link", { name: new RegExp(first.label, "i") })).toContainElement(marks[0] as HTMLElement);
      expect(within(marks[0] as HTMLElement).getByText("Searchable by the assistant")).toBeInTheDocument();
      // An empty outline shows no Contents list.
      expect(screen.queryByText("Contents")).toBeNull();
    });

    it("surfaces the Safety Doc / SOP action buttons that match a resource kind", () => {
      render(<DetailShell tool={toolWithLinks} />);
      // toolWithLinks has an SOP link (kind === "SOP") -> "View SOP" button.
      const sop = screen.getByRole("link", { name: "View SOP" });
      expect(sop).toHaveAttribute("href", "https://example.com/form4-sop");
      // No "Safety" kind link -> no "View Safety Doc" button.
      expect(
        screen.queryByRole("link", { name: "View Safety Doc" })
      ).not.toBeInTheDocument();
    });

    it("renders the units table with each unit's name, serial, status, and condition", () => {
      // The fixture's units carry serials, as a staff viewer's do.
      render(<DetailShell tool={toolWithLinks} />);
      expect(
        screen.getByRole("heading", { name: "Physical Machines" })
      ).toBeInTheDocument();
      const unit = toolWithLinks.units[0];
      // jsdom renders the phone list too; scope to the table (DataTable's rule).
      const table = within(screen.getByRole("table", { name: "Physical Machines" }));
      expect(table.getByText(unit.name)).toBeInTheDocument();
      expect(table.getByRole("columnheader", { name: "Serial" })).toBeInTheDocument();
      expect(table.getByText(unit.serial as string)).toBeInTheDocument();
      // status + condition values are present in the table
      expect(screen.getAllByText("Available").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("table", { name: "Physical Machines" })).toBeInTheDocument();
      expect(table.getByText(unit.condition)).toBeInTheDocument();
    });

    // Data platform spec amendment 2026-10-06: the catalogue sends students
    // and visitors only each serial's masked last four.
    it("draws the masked last four, read as 'Serial ending', for units sent only that", () => {
      const masked = {
        ...toolWithLinks,
        units: toolWithLinks.units.map(({ serial: _serial, ...unit }) => ({ ...unit, serialMasked: "•••• -001" })),
      };
      const { container } = render(<DetailShell tool={masked} />);
      const table = within(screen.getByRole("table", { name: "Physical Machines" }));
      expect(table.getByRole("columnheader", { name: "Serial" })).toBeInTheDocument();
      expect(table.getByText("•••• -001")).toBeInTheDocument();
      expect(table.getByText("Serial ending -001")).toBeInTheDocument();
      // Neither the table nor the phone list carries the whole serial.
      expect(container.textContent).not.toContain(toolWithLinks.units[0].serial as string);
    });

    // A serial of four characters or fewer, or none: nothing to show, so no column.
    it("draws no serial column, and no serial, for units sent without one", () => {
      const withoutSerials = {
        ...toolWithLinks,
        units: toolWithLinks.units.map(({ serial: _serial, ...unit }) => unit),
      };
      const { container } = render(<DetailShell tool={withoutSerials} />);
      const table = within(screen.getByRole("table", { name: "Physical Machines" }));
      expect(table.getByText(toolWithLinks.units[0].name)).toBeInTheDocument();
      expect(table.queryByRole("columnheader", { name: "Serial" })).not.toBeInTheDocument();
      // Neither the table nor the phone list carries it.
      expect(container.textContent).not.toContain(toolWithLinks.units[0].serial as string);
    });

    it("draws the table the page hands it in place of its own", () => {
      render(<DetailShell tool={toolWithLinks} unitsTable={<p>Viewer table</p>} />);
      expect(screen.getByText("Viewer table")).toBeInTheDocument();
      expect(screen.queryByRole("table", { name: "Physical Machines" })).not.toBeInTheDocument();
    });

    it("renders breadcrumbs Tools › tool name, with no Inventory step", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      const crumbs = container.querySelector('[data-slot="tool-breadcrumbs"]') as HTMLElement;
      expect(crumbs).not.toBeNull();
      const scoped = within(crumbs);
      expect(scoped.getByRole("link", { name: "Tools" })).toBeInTheDocument();
      expect(scoped.getByRole("link", { name: "Tools" })).toHaveAttribute("href", "/");
      expect(scoped.queryByText("Inventory")).not.toBeInTheDocument();
      expect(scoped.getByText(toolWithLinks.name)).toHaveAttribute("aria-current", "page");
    });

    it("shows recent maintenance without names, and leaves the section out when there is none", () => {
      const { rerender } = render(
        <DetailShell
          tool={toolWithLinks}
          maintenance={[
            { id: "m1", unitLabel: "Form 4 // A", title: "Resin tank leaking", type: "Issue Report", status: "Open", dateReported: "2026-09-20", dateResolved: "" },
          ]}
        />
      );
      const history = screen.getByRole("region", { name: "Maintenance history" });
      expect(within(history).getByText("Resin tank leaking")).toBeInTheDocument();
      expect(within(history).getByText("2026-09-20")).toBeInTheDocument();
      expect(within(history).getByText("Open")).toBeInTheDocument();
      rerender(<DetailShell tool={toolWithLinks} />);
      expect(screen.queryByRole("region", { name: "Maintenance history" })).not.toBeInTheDocument();
    });

    it("mounts without error (smoke for the whole shell)", () => {
      expect(() => render(<DetailShell tool={toolWithLinks} />)).not.toThrow();
    });
  });

  describe("with an In-Use multi-unit tool", () => {
    it("shows the In Use status chip", () => {
      render(<DetailShell tool={inUseTool} />);
      // status chip + each in-use unit row may also show "In Use"
      expect(screen.getAllByText("In use").length).toBeGreaterThanOrEqual(1);
    });

    it("renders a row for every unit", () => {
      render(<DetailShell tool={inUseTool} />);
      const table = within(screen.getByRole("table", { name: "Physical Machines" }));
      for (const unit of inUseTool.units) {
        expect(table.getByRole("rowheader", { name: unit.name })).toBeInTheDocument();
      }
    });
  });

  describe("conditional rendering", () => {
    it("leaves out the materials row when there are no materials (no placeholder)", () => {
      const noMaterials = { ...toolWithLinks, materials: [] };
      render(<DetailShell tool={noMaterials} />);
      const specs = document.querySelector('[data-slot="tool-specs"]') as HTMLElement;
      expect(within(specs).queryByText("Materials")).not.toBeInTheDocument();
      expect(screen.queryByText("Contact MakerLab staff")).not.toBeInTheDocument();
    });

    it("leaves out Documents & Resources when there are no links (no empty box)", () => {
      const noLinks = { ...toolWithLinks, links: [] };
      render(<DetailShell tool={noLinks} />);
      expect(screen.queryByRole("region", { name: "Documents & Resources" })).not.toBeInTheDocument();
      expect(screen.queryByText("No documents linked yet.")).not.toBeInTheDocument();
    });

    it("lays Details beside Documents and the machines in two columns", () => {
      render(<DetailShell tool={toolWithLinks} />);
      const columns = document.querySelector('[data-slot="tool-columns"]') as HTMLElement;
      expect(columns.className).toMatch(/lg:grid-cols-2/);
      expect(within(columns).getByRole("region", { name: "Details" })).toBeInTheDocument();
      expect(within(columns).getByRole("region", { name: "Documents & Resources" })).toBeInTheDocument();
    });

    it("omits the PPE-required chip and the PPE row when ppe is empty", () => {
      const noPpe = { ...toolWithLinks, ppe: [] };
      render(<DetailShell tool={noPpe} />);
      expect(screen.queryByText("PPE Required")).not.toBeInTheDocument();
    });

    it("falls back to the lab's standing guidance when a tool records no safety facts", () => {
      render(<DetailShell tool={{ ...inUseTool, ppe: [], emergencyStop: null, useRestrictions: null }} />);
      expect(
        screen.getByText(
          "Follow posted lab guidance and notify staff in an emergency."
        )
      ).toBeInTheDocument();
    });

    it("renders the offline tool's status chip", () => {
      render(<DetailShell tool={offlineTool} />);
      // "Offline" status chip + offline unit status/condition.
      expect(screen.getAllByText("Offline").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("lab notes (identity spec amendment \"Lab notes\")", () => {
    const cutter = {
      ...toolWithLinks,
      notes: "- Always put a cutting mat underneath so you don't scratch the table.\n\nReturn the blade to the drawer.",
    };

    it("shows them in the hero, above the description, as the lab staff's words", () => {
      render(<DetailShell tool={cutter} />);
      const hero = document.querySelector('[data-slot="tool-hero"]') as HTMLElement;
      const notes = within(hero).getByRole("region", { name: /Lab notes/ });

      expect(within(notes).getByText("From the lab's staff")).toBeInTheDocument();
      const description = within(hero).getByText(cutter.description);
      expect(notes.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("lists one note per line, with typed list markers and blank lines dropped", () => {
      render(<DetailShell tool={cutter} />);
      const notes = screen.getByRole("region", { name: /Lab notes/ });

      expect(within(notes).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "Always put a cutting mat underneath so you don't scratch the table.",
        "Return the blade to the drawer.",
      ]);
    });

    it("shows a single note as a sentence, not a one-item list", () => {
      render(<DetailShell tool={toolWithLinks} />);
      const notes = screen.getByRole("region", { name: /Lab notes/ });

      expect(within(notes).queryByRole("list")).not.toBeInTheDocument();
      expect(within(notes).getByText(toolWithLinks.notes as string)).toBeInTheDocument();
    });

    it("is no longer a Details row", () => {
      render(<DetailShell tool={cutter} />);
      const specs = document.querySelector('[data-slot="tool-specs"]') as HTMLElement;

      expect(within(specs).queryByText("Notes")).not.toBeInTheDocument();
      expect(within(specs).queryByText(/cutting mat/)).not.toBeInTheDocument();
    });

    it("is absent when the tool has none, or only blank lines", () => {
      const { unmount } = render(<DetailShell tool={{ ...toolWithLinks, notes: null }} />);
      expect(document.querySelector('[data-slot="tool-lab-notes"]')).toBeNull();
      unmount();

      render(<DetailShell tool={{ ...toolWithLinks, notes: " \n  \n" }} />);
      expect(document.querySelector('[data-slot="tool-lab-notes"]')).toBeNull();
    });
  });
});
