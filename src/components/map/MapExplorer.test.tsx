import { useMemo, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "../../../test/utils/render";
import { availableTool, inUseTool } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";

/**
 * Next keeps `useSearchParams` in step with `history.pushState` / Back. The
 * stand-in does the same over jsdom's history: pushState and replaceState
 * announce themselves, and popstate is what Back fires.
 */
const URL_EVENT = "test:url";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => {
    const search = useSyncExternalStore(
      (onChange) => {
        window.addEventListener("popstate", onChange);
        window.addEventListener(URL_EVENT, onChange);
        return () => {
          window.removeEventListener("popstate", onChange);
          window.removeEventListener(URL_EVENT, onChange);
        };
      },
      () => window.location.search
    );
    return useMemo(() => new URLSearchParams(search), [search]);
  },
}));

import { STUDIO_101 } from "../../lib/map/studio-101";
import { MapExplorer } from "./MapExplorer";
import { mapPlaceUrl } from "./map-url";

const printer: MakerLabTool = { ...availableTool, id: "t-printer", slug: "form-4", name: "Form 4", location: "Studio 101", zone: "3D Printing Hub", mapId: null };
const laser: MakerLabTool = { ...inUseTool, id: "t-laser", slug: "trotec", name: "Trotec Speedy 400", location: "Studio 101C", zone: "Laser Machine Room", mapId: "4A" };
const TOOLS = [printer, laser];

const realPush = window.history.pushState.bind(window.history);
const realReplace = window.history.replaceState.bind(window.history);
let pushes: string[] = [];

beforeEach(() => {
  pushes = [];
  realReplace(null, "", "/map");
  vi.spyOn(window.history, "pushState").mockImplementation((state, unused, url) => {
    pushes.push(String(url));
    realPush(state, unused, url);
    window.dispatchEvent(new Event(URL_EVENT));
  });
  vi.spyOn(window.history, "replaceState").mockImplementation((state, unused, url) => {
    realReplace(state, unused, url);
    window.dispatchEvent(new Event(URL_EVENT));
  });
});

afterEach(() => vi.restoreAllMocks());

function zoneBar() {
  return within(screen.getByRole("navigation", { name: "Zones" }));
}

describe("mapPlaceUrl", () => {
  it("writes the place and the search, and plain /map for neither", () => {
    expect(mapPlaceUrl(null)).toBe("/map");
    expect(mapPlaceUrl("Z2")).toBe("/map?highlight=Z2");
    expect(mapPlaceUrl("4A", " laser ")).toBe("/map?highlight=4A&q=laser");
    expect(mapPlaceUrl(null, "resin")).toBe("/map?q=resin");
  });
});

describe("MapExplorer — zone navigation (map UX pass)", () => {
  it("picking a zone pushes it onto the history and opens its panel with the way back", () => {
    render(<MapExplorer plan={STUDIO_101} tools={TOOLS} />);
    expect(zoneBar().getByRole("link", { name: /All zones/ })).toHaveAttribute("aria-current", "location");
    expect(screen.queryByRole("button", { name: "Whole map" })).toBeNull();

    fireEvent.click(zoneBar().getByRole("link", { name: /2 · 3D Printing Hub/ }));

    expect(pushes).toEqual(["/map?highlight=Z2"]);
    expect(window.location.search).toBe("?highlight=Z2");
    expect(screen.getByRole("heading", { level: 2, name: "Zone 2 · 3D Printing Hub" })).toBeInTheDocument();
    expect(zoneBar().getByRole("link", { name: /2 · 3D Printing Hub/ })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("button", { name: "Whole map" })).toBeInTheDocument();
    // The zone's tools link to their pages.
    const table = screen.getByRole("table", { name: "Tools at Zone 2 · 3D Printing Hub" });
    expect(within(table).getByText("Form 4")).toBeInTheDocument();
    expect(within(table).queryByText("Trotec Speedy 400")).toBeNull();
    // The breadcrumb leads back up.
    const crumbs = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(crumbs.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/map");
  });

  it("“Whole map” returns to the plan as a new history entry", () => {
    realReplace(null, "", "/map?highlight=Z2");
    render(<MapExplorer plan={STUDIO_101} tools={TOOLS} />);
    fireEvent.click(screen.getByRole("button", { name: "Whole map" }));
    expect(pushes).toEqual(["/map"]);
    expect(screen.queryByRole("heading", { level: 2, name: "Zone 2 · 3D Printing Hub" })).toBeNull();
  });

  it("the browser's Back button (popstate) goes back to the whole map", () => {
    render(<MapExplorer plan={STUDIO_101} tools={TOOLS} />);
    fireEvent.click(zoneBar().getByRole("link", { name: /4 · Laser Machine Room/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Zone 4 · Laser Machine Room" })).toBeInTheDocument();

    act(() => {
      realReplace(null, "", "/map");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.queryByRole("heading", { level: 2, name: "Zone 4 · Laser Machine Room" })).toBeNull();
  });

  it("Escape leaves the place, but not while a dialog has focus", () => {
    realReplace(null, "", "/map?highlight=Z2");
    render(
      <>
        <div role="dialog">
          <button type="button">In the chat</button>
        </div>
        <MapExplorer plan={STUDIO_101} tools={TOOLS} />
      </>
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "In the chat" }), { key: "Escape" });
    expect(pushes).toEqual([]);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(pushes).toEqual(["/map"]);
  });

  it("a station view names its zone as a link back to it, and lists its tools", () => {
    realReplace(null, "", "/map?highlight=4A");
    render(<MapExplorer plan={STUDIO_101} tools={TOOLS} />);
    expect(screen.getByRole("heading", { level: 2, name: "4A · Trotec Laser Machine" })).toBeInTheDocument();
    const toZone = screen.getByRole("link", { name: "In zone 4, Laser Machine Room" });
    expect(toZone).toHaveAttribute("href", "/map?highlight=Z4");
    fireEvent.click(toZone);
    expect(pushes).toEqual(["/map?highlight=Z4"]);
    expect(screen.getByRole("heading", { level: 2, name: "Zone 4 · Laser Machine Room" })).toBeInTheDocument();
  });

  it("a zone view offers its stations; typing a search replaces the URL instead of pushing", () => {
    realReplace(null, "", "/map?highlight=Z4");
    render(<MapExplorer plan={STUDIO_101} tools={TOOLS} />);
    const stations = screen.getByRole("heading", { level: 3, name: "Stations in this zone" }).parentElement!;
    expect(within(stations).getByRole("link", { name: /4A Trotec Laser Machine/ })).toHaveAttribute("href", "/map?highlight=4A");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "trotec" } });
    expect(pushes).toEqual([]);
    expect(window.location.search).toBe("?highlight=Z4&q=trotec");
  });

  it("searching with no place picked lists the matches with where they are", () => {
    render(<MapExplorer plan={STUDIO_101} tools={TOOLS} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "form" } });
    const table = screen.getByRole("table", { name: "Matches for “form”" });
    expect(within(table).getByText("Form 4")).toBeInTheDocument();
    expect(within(table).getByText("3D Printing Hub", { exact: false })).toBeInTheDocument();
  });
});
