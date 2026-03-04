import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SearchAndFilters from "@/components/SearchAndFilters";
import type { ToolWithMeta } from "@/lib/types";

/** Factory for a minimal ToolWithMeta used to satisfy the tools prop. */
function makeTool(overrides: Partial<ToolWithMeta> = {}): ToolWithMeta {
  return {
    id: "rec123",
    name: "Test Tool",
    description: "A test tool.",
    category_group: "3D Printing",
    category_sub: "FDM",
    location_room: "Main Lab",
    location_zone: "Zone A",
    materials: ["PLA"],
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
    image_url: null,
    generated_image_url: null,
    image_attachments: [],
    generated_image: [],
    manual_attachments: [],
    ...overrides,
  };
}

/** Default props for SearchAndFilters. */
function defaultProps(overrides: Partial<Parameters<typeof SearchAndFilters>[0]> = {}) {
  return {
    tools: [makeTool()],
    query: "",
    categoryGroups: ["3D Printing", "Woodworking", "Electronics"],
    rooms: ["Main Lab", "Annex"],
    materials: ["PLA", "Wood", "Aluminum"],
    selectedCategories: [],
    selectedRooms: [],
    selectedMaterials: [],
    onQueryChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onRoomChange: vi.fn(),
    onMaterialChange: vi.fn(),
    ...overrides,
  };
}

describe("SearchAndFilters", () => {
  it("renders the search input with the correct placeholder", () => {
    render(<SearchAndFilters {...defaultProps()} />);
    const input = screen.getByPlaceholderText(
      "Search tools by name, description, material, or tag..."
    );
    expect(input).toBeInTheDocument();
  });

  it("renders the current query value in the search input", () => {
    render(<SearchAndFilters {...defaultProps({ query: "laser" })} />);
    const input = screen.getByPlaceholderText(
      "Search tools by name, description, material, or tag..."
    ) as HTMLInputElement;
    expect(input.value).toBe("laser");
  });

  it("calls onQueryChange when typing in the search input", () => {
    const onQueryChange = vi.fn();
    render(<SearchAndFilters {...defaultProps({ onQueryChange })} />);
    const input = screen.getByPlaceholderText(
      "Search tools by name, description, material, or tag..."
    );
    fireEvent.change(input, { target: { value: "drill" } });
    expect(onQueryChange).toHaveBeenCalledWith("drill");
  });

  it("renders category buttons in the carousel", () => {
    render(<SearchAndFilters {...defaultProps()} />);
    expect(screen.getByText("3D Printing")).toBeInTheDocument();
    expect(screen.getByText("Woodworking")).toBeInTheDocument();
    expect(screen.getByText("Electronics")).toBeInTheDocument();
  });

  it("calls onCategoryChange when a category button is clicked", () => {
    const onCategoryChange = vi.fn();
    render(<SearchAndFilters {...defaultProps({ onCategoryChange })} />);
    fireEvent.click(screen.getByText("Woodworking"));
    expect(onCategoryChange).toHaveBeenCalledWith(["Woodworking"]);
  });

  it("renders the Room accordion section", () => {
    render(<SearchAndFilters {...defaultProps()} />);
    expect(screen.getByText("Room")).toBeInTheDocument();
  });

  it("shows room options when Room accordion is expanded", () => {
    render(<SearchAndFilters {...defaultProps()} />);
    // Click the Room accordion to expand it
    fireEvent.click(screen.getByText("Room"));
    expect(screen.getByText("Main Lab")).toBeInTheDocument();
    expect(screen.getByText("Annex")).toBeInTheDocument();
  });

  it("renders the Materials accordion section", () => {
    render(<SearchAndFilters {...defaultProps()} />);
    expect(screen.getByText("Materials")).toBeInTheDocument();
  });

  it("renders the Filter by header", () => {
    render(<SearchAndFilters {...defaultProps()} />);
    expect(screen.getByText("Filter by")).toBeInTheDocument();
  });
});
