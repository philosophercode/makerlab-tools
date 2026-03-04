import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ToolGrid from "@/components/ToolGrid";
import type { ToolWithMeta } from "@/lib/types";

// Mock next/image as a simple img element
vi.mock("next/image", () => ({
  default: (props: any) => <img {...props} />,
}));

// Mock the image-processing module (used by ToolCard internally)
vi.mock("@/lib/image-processing", () => ({
  setProcessing: vi.fn(),
  clearProcessing: vi.fn(),
  getProcessing: vi.fn(() => null),
}));

/** Factory for a fully-populated ToolWithMeta object. */
function makeTool(overrides: Partial<ToolWithMeta> = {}): ToolWithMeta {
  return {
    id: "rec123",
    name: "Ultimaker S5",
    description: "Dual-extrusion FDM 3D printer.",
    category_group: "3D Printing",
    category_sub: "FDM",
    location_room: "Main Lab",
    location_zone: "Zone A",
    materials: ["PLA", "ABS"],
    ppe_required: [],
    tags: [],
    authorized_only: false,
    training_required: false,
    use_restrictions: null,
    emergency_stop: null,
    notes: null,
    safety_doc_url: null,
    sop_url: null,
    video_url: null,
    map_tag: null,
    image_url: "https://example.com/img.png",
    generated_image_url: null,
    image_attachments: [],
    generated_image: [],
    manual_attachments: [],
    ...overrides,
  };
}

describe("ToolGrid", () => {
  it("renders a grid of tool cards", () => {
    const tools = [
      makeTool({ id: "rec1", name: "Band Saw" }),
      makeTool({ id: "rec2", name: "Drill Press" }),
    ];
    render(<ToolGrid tools={tools} />);
    expect(screen.getByText("Band Saw")).toBeInTheDocument();
    expect(screen.getByText("Drill Press")).toBeInTheDocument();
  });

  it("shows empty state message when tools array is empty", () => {
    render(<ToolGrid tools={[]} />);
    expect(screen.getByText("No tools found")).toBeInTheDocument();
    expect(
      screen.getByText("Try adjusting your search or filters.")
    ).toBeInTheDocument();
  });

  it("renders the correct number of tool links", () => {
    const tools = [
      makeTool({ id: "rec1", name: "Tool A" }),
      makeTool({ id: "rec2", name: "Tool B" }),
      makeTool({ id: "rec3", name: "Tool C" }),
    ];
    render(<ToolGrid tools={tools} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
  });

  it("passes correct href to each tool card", () => {
    const tools = [
      makeTool({ id: "recAAA", name: "Laser Cutter" }),
      makeTool({ id: "recBBB", name: "CNC Router" }),
    ];
    render(<ToolGrid tools={tools} />);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/tools/recAAA");
    expect(links[1]).toHaveAttribute("href", "/tools/recBBB");
  });

  it("renders in compact mode by default (hides descriptions)", () => {
    const tools = [makeTool({ id: "rec1", name: "Sewing Machine", description: "Industrial sewing machine." })];
    render(<ToolGrid tools={tools} viewMode="compact" />);
    // In compact mode, ToolCard does not render the description
    expect(screen.queryByText("Industrial sewing machine.")).not.toBeInTheDocument();
  });

  it("renders descriptions in grid view mode", () => {
    const tools = [
      makeTool({ id: "rec1", name: "Sewing Machine", description: "Industrial sewing machine." }),
    ];
    render(<ToolGrid tools={tools} viewMode="grid" />);
    expect(screen.getByText("Industrial sewing machine.")).toBeInTheDocument();
  });

  it("renders table view when viewMode is table", () => {
    const tools = [
      makeTool({ id: "rec1", name: "Soldering Station" }),
      makeTool({ id: "rec2", name: "Oscilloscope" }),
    ];
    render(<ToolGrid tools={tools} viewMode="table" />);
    expect(screen.getByText("Soldering Station")).toBeInTheDocument();
    expect(screen.getByText("Oscilloscope")).toBeInTheDocument();
    // Table view has column headers
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
  });
});
