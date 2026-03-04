import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import FilterChips from "@/components/FilterChips";

/** Default props with no active filters. */
function defaultProps(overrides: Partial<Parameters<typeof FilterChips>[0]> = {}) {
  return {
    query: "",
    selectedCategories: [],
    selectedRooms: [],
    selectedMaterials: [],
    onRemoveQuery: vi.fn(),
    onRemoveCategory: vi.fn(),
    onRemoveRoom: vi.fn(),
    onRemoveMaterial: vi.fn(),
    onClearAll: vi.fn(),
    resultCount: 0,
    ...overrides,
  };
}

describe("FilterChips", () => {
  it("renders active filter chips for categories, rooms, and materials", () => {
    render(
      <FilterChips
        {...defaultProps({
          selectedCategories: ["3D Printing"],
          selectedRooms: ["Main Lab"],
          selectedMaterials: ["PLA"],
          resultCount: 5,
        })}
      />
    );
    expect(screen.getByText("3D Printing")).toBeInTheDocument();
    expect(screen.getByText("Main Lab")).toBeInTheDocument();
    expect(screen.getByText("PLA")).toBeInTheDocument();
  });

  it("shows the Clear all button", () => {
    render(
      <FilterChips
        {...defaultProps({
          selectedCategories: ["Woodworking"],
          resultCount: 3,
        })}
      />
    );
    expect(screen.getByText("Clear all")).toBeInTheDocument();
  });

  it("calls onRemoveCategory when a category chip X button is clicked", () => {
    const onRemoveCategory = vi.fn();
    render(
      <FilterChips
        {...defaultProps({
          selectedCategories: ["Electronics"],
          onRemoveCategory,
          resultCount: 2,
        })}
      />
    );
    const removeBtn = screen.getByLabelText("Remove Electronics filter");
    fireEvent.click(removeBtn);
    expect(onRemoveCategory).toHaveBeenCalledWith("Electronics");
  });

  it("calls onRemoveRoom when a room chip X button is clicked", () => {
    const onRemoveRoom = vi.fn();
    render(
      <FilterChips
        {...defaultProps({
          selectedRooms: ["Main Lab"],
          onRemoveRoom,
          resultCount: 4,
        })}
      />
    );
    const removeBtn = screen.getByLabelText("Remove Main Lab filter");
    fireEvent.click(removeBtn);
    expect(onRemoveRoom).toHaveBeenCalledWith("Main Lab");
  });

  it("calls onRemoveMaterial when a material chip X button is clicked", () => {
    const onRemoveMaterial = vi.fn();
    render(
      <FilterChips
        {...defaultProps({
          selectedMaterials: ["ABS"],
          onRemoveMaterial,
          resultCount: 1,
        })}
      />
    );
    const removeBtn = screen.getByLabelText("Remove ABS filter");
    fireEvent.click(removeBtn);
    expect(onRemoveMaterial).toHaveBeenCalledWith("ABS");
  });

  it("calls onClearAll when Clear all button is clicked", () => {
    const onClearAll = vi.fn();
    render(
      <FilterChips
        {...defaultProps({
          selectedCategories: ["3D Printing"],
          onClearAll,
          resultCount: 10,
        })}
      />
    );
    fireEvent.click(screen.getByText("Clear all"));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("displays the result count", () => {
    render(
      <FilterChips {...defaultProps({ resultCount: 42 })} />
    );
    expect(screen.getByText("42 results")).toBeInTheDocument();
  });

  it("displays singular 'result' when count is 1", () => {
    render(
      <FilterChips {...defaultProps({ resultCount: 1 })} />
    );
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("renders a query chip when query is non-empty", () => {
    const onRemoveQuery = vi.fn();
    render(
      <FilterChips
        {...defaultProps({
          query: "laser",
          onRemoveQuery,
          resultCount: 3,
        })}
      />
    );
    // The query chip wraps the text in quotes
    expect(screen.getByText(/\"laser\"/)).toBeInTheDocument();
  });
});
