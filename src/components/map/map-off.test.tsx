/**
 * A lab with no map (lab config `map: false`, spec §5.5): no /map page, no
 * MAP in the nav, and the assistant's `map` is null.
 */
vi.mock("../../lib/lab/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/lab/config")>();
  return { ...actual, lab: { ...actual.lab, map: false } };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  usePathname: () => "/",
}));

import { mapFactsFor } from "../../lib/map/locate";
import { FLOOR_PLANS, LAB_PLAN } from "../../lib/map/plan";
import { render, screen } from "../../../test/utils/render";
import { PrimaryNav } from "../PrimaryNav";
import { MapGate } from "./MapGate";

describe("map: false", () => {
  it("has no plan, so no tool is placed and the assistant gets map: null", () => {
    expect(LAB_PLAN).toBeNull();
    expect(FLOOR_PLANS).toEqual([]);
    expect(mapFactsFor({ mapId: "4A", location: "Studio 101C", zone: "Laser Machine Room" })).toBeNull();
  });

  it("answers /map with 404", async () => {
    await expect(MapGate()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("leaves MAP out of the nav", () => {
    render(<PrimaryNav />);
    expect(screen.getAllByRole("link", { name: "TOOLS" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "MAP" })).not.toBeInTheDocument();
  });
});
