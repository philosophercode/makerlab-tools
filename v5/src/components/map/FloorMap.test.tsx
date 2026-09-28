import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FloorMap, type FloorMapLabels } from "./FloorMap";
import { STUDIO_101 } from "../../lib/map/studio-101";
import { indexPlan, mapHref, resolveHighlight } from "../../lib/map/placement";

const labels: FloorMapLabels = {
  title: "Floor plan of Studio 101",
  zone: (zone, count) => `Zone ${zone.number}, ${zone.zone}: ${count} tools`,
  station: (station, count) => `Station ${station.id}, ${station.label}: ${count} tools`,
  zoneCount: (count) => `${count} TOOLS`,
};

describe("FloorMap", () => {
  it("full mode: every zone and station is a named link to its /map view", () => {
    render(
      <FloorMap
        plan={STUDIO_101}
        mode="full"
        labels={labels}
        zoneCounts={new Map([["Z3", 57]])}
        hrefFor={mapHref}
      />
    );
    const group = screen.getByRole("group", { name: "Floor plan of Studio 101" });
    expect(group).toBeInTheDocument();
    const machining = screen.getByRole("link", { name: "Zone 3, Machining Shop: 57 tools" });
    expect(machining).toHaveAttribute("href", "/map?highlight=Z3");
    expect(screen.getByRole("link", { name: /Station 1C, Vinyl Cutting Station/ })).toHaveAttribute(
      "href",
      "/map?highlight=1C"
    );
    expect(screen.getAllByRole("link")).toHaveLength(STUDIO_101.zones.length + STUDIO_101.stations.length);
  });

  it("full mode: onSelect takes the click instead of navigating", () => {
    const onSelect = vi.fn();
    render(<FloorMap plan={STUDIO_101} mode="full" labels={labels} hrefFor={mapHref} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("link", { name: /Zone 4, Laser Machine Room/ }));
    expect(onSelect).toHaveBeenCalledWith("Z4");
  });

  it("thumbnail: one named picture, nothing focusable, only the station that is here", () => {
    const here = resolveHighlight(indexPlan(STUDIO_101), "4A");
    const { container } = render(
      <FloorMap plan={STUDIO_101} mode="thumbnail" labels={{ ...labels, title: "Trotec is at 4A" }} here={here} />
    );
    expect(screen.getByRole("img", { name: "Trotec is at 4A" })).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelectorAll("[data-station]")).toHaveLength(1);
    expect(container.querySelector('[data-here="true"]')).not.toBeNull();
  });
});
