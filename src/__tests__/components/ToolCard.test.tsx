import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ToolCard from "@/components/ToolCard";
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
    description: "Dual-extrusion FDM 3D printer for PLA, ABS, and specialty filaments.",
    category_group: "3D Printing",
    category_sub: "FDM",
    location_room: "Main Lab",
    location_zone: "Zone A",
    materials: ["PLA", "ABS", "PETG"],
    ppe_required: ["Safety Glasses"],
    tags: ["fdm", "3d-printing"],
    authorized_only: false,
    training_required: true,
    use_restrictions: null,
    emergency_stop: null,
    notes: null,
    safety_doc_url: null,
    sop_url: null,
    video_url: null,
    map_tag: null,
    image_url: "https://example.com/ultimaker.png",
    generated_image_url: null,
    image_attachments: [],
    generated_image: [],
    manual_attachments: [],
    ...overrides,
  };
}

describe("ToolCard", () => {
  it("renders the tool name", () => {
    render(<ToolCard tool={makeTool()} />);
    expect(screen.getByText("Ultimaker S5")).toBeInTheDocument();
  });

  it("renders the tool description", () => {
    render(<ToolCard tool={makeTool()} />);
    expect(
      screen.getByText(
        "Dual-extrusion FDM 3D printer for PLA, ABS, and specialty filaments."
      )
    ).toBeInTheDocument();
  });

  it("renders the category group badge", () => {
    render(<ToolCard tool={makeTool()} />);
    expect(screen.getByText("3D Printing")).toBeInTheDocument();
  });

  it("shows training badge when training_required is true", () => {
    render(<ToolCard tool={makeTool({ training_required: true })} />);
    expect(screen.getByText("Training")).toBeInTheDocument();
  });

  it("does not show training badge when training_required is false", () => {
    render(
      <ToolCard
        tool={makeTool({ training_required: false, ppe_required: [], authorized_only: false })}
      />
    );
    expect(screen.queryByText("Training")).not.toBeInTheDocument();
  });

  it("renders the tool image when image_url is provided", () => {
    render(<ToolCard tool={makeTool()} />);
    const img = screen.getByAltText("Ultimaker S5");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/ultimaker.png");
  });

  it("shows placeholder text when no image is available", () => {
    render(
      <ToolCard tool={makeTool({ image_url: null, generated_image_url: null })} />
    );
    expect(screen.getByText("No image")).toBeInTheDocument();
  });

  it("links to the correct tool detail page", () => {
    render(<ToolCard tool={makeTool({ id: "recABC123" })} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/tools/recABC123");
  });

  it("shows PPE Required badge when ppe_required has items", () => {
    render(<ToolCard tool={makeTool({ ppe_required: ["Safety Glasses"] })} />);
    expect(screen.getByText("PPE Required")).toBeInTheDocument();
  });

  it("shows Auth Only badge when authorized_only is true", () => {
    render(<ToolCard tool={makeTool({ authorized_only: true })} />);
    expect(screen.getByText("Auth Only")).toBeInTheDocument();
  });
});
