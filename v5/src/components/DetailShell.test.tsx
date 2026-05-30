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
      const img = container.querySelector(".td-hero-image img") as HTMLImageElement;
      expect(img).not.toBeNull();
      // next/image rewrites the src through the optimizer but the original
      // path is encoded in the URL — assert the original filename survives.
      expect(decodeURIComponent(img.src)).toContain(toolWithLinks.imageSrc);
    });

    it("renders the description text", () => {
      render(<DetailShell tool={toolWithLinks} />);
      expect(screen.getByText(toolWithLinks.description)).toBeInTheDocument();
    });

    it("renders the status chip and a training chip", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      // status === "Available" — scope to the status chip row (the unit table
      // also shows "Available" for the available unit).
      const chipRow = container.querySelector(
        '.td-chip-row[aria-label="Tool status"]'
      ) as HTMLElement;
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

    it("lists materials (joined) in the at-a-glance card and details table", () => {
      render(<DetailShell tool={toolWithLinks} />);
      const joined = toolWithLinks.materials.join(", ");
      // Appears in the glance card and the details table => >= 2.
      expect(screen.getAllByText(joined).length).toBeGreaterThanOrEqual(2);
    });

    it("renders category and location in the details table", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      const table = container.querySelector(".td-kv-table") as HTMLElement;
      expect(table).not.toBeNull();
      const rowText = Array.from(table.querySelectorAll("tr")).map((tr) =>
        (tr.textContent || "").replace(/\s+/g, " ").trim()
      );
      // category / categorySub combined cell (text split across nodes in the DOM;
      // textContent of the <tr> concatenates the <th> label and the <td> value).
      expect(rowText).toContain(
        `Category${toolWithLinks.category} / ${toolWithLinks.categorySub}`
      );
      // location / zone combined cell
      expect(rowText).toContain(
        `Location${toolWithLinks.location} / ${toolWithLinks.zone}`
      );
    });

    it("renders each resource link with its href and label", () => {
      render(<DetailShell tool={toolWithLinks} />);
      for (const link of toolWithLinks.links) {
        const anchor = screen.getByRole("link", { name: new RegExp(link.label, "i") });
        expect(anchor).toHaveAttribute("href", link.href);
      }
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
      render(<DetailShell tool={toolWithLinks} />);
      expect(
        screen.getByRole("heading", { name: "Physical Machines" })
      ).toBeInTheDocument();
      const unit = toolWithLinks.units[0];
      expect(screen.getByText(unit.name)).toBeInTheDocument();
      expect(screen.getByText(unit.serial)).toBeInTheDocument();
      // status + condition values are present in the table
      expect(screen.getAllByText(unit.status).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(unit.condition)).toBeInTheDocument();
    });

    it("renders the back-to-tools link", () => {
      render(<DetailShell tool={toolWithLinks} />);
      const back = screen.getByRole("link", { name: /Back to all tools/i });
      expect(back).toHaveAttribute("href", "/");
    });

    it("renders breadcrumbs ending in the tool name", () => {
      const { container } = render(<DetailShell tool={toolWithLinks} />);
      const crumbs = container.querySelector(".td-breadcrumbs") as HTMLElement;
      expect(crumbs).not.toBeNull();
      const scoped = within(crumbs);
      expect(scoped.getByRole("link", { name: "Tools" })).toBeInTheDocument();
      expect(scoped.getByText("Inventory")).toBeInTheDocument();
      expect(scoped.getByText(toolWithLinks.name)).toBeInTheDocument();
    });

    it("mounts without error (smoke for the whole shell)", () => {
      expect(() => render(<DetailShell tool={toolWithLinks} />)).not.toThrow();
    });
  });

  describe("with an In-Use multi-unit tool", () => {
    it("shows the In Use status chip", () => {
      render(<DetailShell tool={inUseTool} />);
      // status chip + each in-use unit row may also show "In Use"
      expect(screen.getAllByText("In Use").length).toBeGreaterThanOrEqual(1);
    });

    it("renders a row for every unit", () => {
      render(<DetailShell tool={inUseTool} />);
      for (const unit of inUseTool.units) {
        expect(screen.getByText(unit.name)).toBeInTheDocument();
      }
    });
  });

  describe("conditional rendering", () => {
    it("falls back to 'Contact MakerLab staff' when there are no materials", () => {
      const noMaterials = { ...toolWithLinks, materials: [] };
      render(<DetailShell tool={noMaterials} />);
      expect(
        screen.getAllByText("Contact MakerLab staff").length
      ).toBeGreaterThanOrEqual(1);
    });

    it("shows the no-documents empty state when there are no links", () => {
      const noLinks = { ...toolWithLinks, links: [] };
      render(<DetailShell tool={noLinks} />);
      expect(screen.getByText("No documents linked yet.")).toBeInTheDocument();
    });

    it("omits the PPE-required chip when ppe is empty", () => {
      const noPpe = { ...toolWithLinks, ppe: [] };
      render(<DetailShell tool={noPpe} />);
      // The "PPE Required" safety-section heading still renders, but the chip
      // (inside .td-chip-row) is gone. With no PPE there is exactly one match
      // (the section heading) instead of two.
      expect(screen.getAllByText("PPE Required")).toHaveLength(1);
    });

    it("renders the emergency-stop fallback when emergencyStop is null", () => {
      render(<DetailShell tool={inUseTool} />); // inUseTool.emergencyStop === null
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
});
