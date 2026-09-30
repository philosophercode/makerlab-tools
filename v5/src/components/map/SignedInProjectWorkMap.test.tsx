import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../../test/utils/render";
import { identityFor } from "../../../test/utils/identities";
import { availableTool, inUseTool, offlineTool } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";

vi.mock("../../lib/auth/identity", () => ({ resolveIdentityFromHeaders: vi.fn() }));
vi.mock("../../lib/catalog", () => ({ getCatalogTools: vi.fn() }));

import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { getCatalogTools } from "../../lib/catalog";
import { SignedInProjectWorkMap } from "./SignedInProjectWorkMap";

const printer: MakerLabTool = { ...availableTool, id: "t-printer", slug: "form-4", name: "Form 4", location: "Studio 101", zone: "3D Printing Hub", mapId: null };
const laser: MakerLabTool = { ...inUseTool, id: "t-laser", slug: "trotec", name: "Trotec", location: "Studio 101C", zone: "Laser Machine Room", mapId: "4A" };
const lost: MakerLabTool = { ...offlineTool, id: "t-lost", slug: "mystery", name: "Mystery box", location: "Unknown", zone: "Unknown", mapId: null };

const refs = [laser, printer, lost].map(({ id, name, slug }) => ({ id, name, slug }));

describe("SignedInProjectWorkMap (project “Where you’ll work”, map access)", () => {
  beforeEach(() => {
    vi.mocked(resolveIdentityFromHeaders).mockReset();
    vi.mocked(getCatalogTools).mockReset().mockResolvedValue([printer, laser, lost]);
  });

  it("sends a signed-out visitor nothing, and never reads the catalogue for them", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("anonymous"));
    expect(await SignedInProjectWorkMap({ tools: refs })).toBeNull();
    expect(getCatalogTools).not.toHaveBeenCalled();
  });

  it("renders nothing for a project with no tools", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("user"));
    expect(await SignedInProjectWorkMap({ tools: [] })).toBeNull();
  });

  it("groups a signed-in visitor's project tools by zone, in plan order, with links", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("user"));
    const element = await SignedInProjectWorkMap({ tools: refs });
    const { container } = render(element!);

    expect(screen.getByRole("heading", { name: "Where you’ll work" })).toBeInTheDocument();
    expect(screen.getByText("The 3 tools this project used are spread over 2 zones of the lab.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Floor plan with zones 2, 4 highlighted" })).toBeInTheDocument();

    const groups = [...container.querySelectorAll("li[data-zone]")].map((li) => li.getAttribute("data-zone"));
    expect(groups).toEqual(["Z2", "Z4", "unplaced"]);

    const zone4 = within(container.querySelector('li[data-zone="Z4"]') as HTMLElement);
    expect(zone4.getByRole("link", { name: /Zone 4 · Laser Machine Room/ })).toHaveAttribute("href", "/map?highlight=Z4");
    expect(zone4.getByRole("link", { name: /Trotec/ })).toHaveAttribute("href", "/tools/trotec");
    expect(zone4.getByText("4A")).toBeInTheDocument();

    const unplaced = within(container.querySelector('li[data-zone="unplaced"]') as HTMLElement);
    expect(unplaced.getByText("Not on the map")).toBeInTheDocument();
    expect(unplaced.getByRole("link", { name: /Mystery box/ })).toHaveAttribute("href", "/tools/mystery");

    // The two zones are lit on the map, and the one station a tool names is drawn.
    expect(container.querySelectorAll('.fm-zone[data-match="true"]')).toHaveLength(2);
    expect([...container.querySelectorAll("[data-station]")].map((el) => el.getAttribute("data-station"))).toEqual(["4A"]);
  });

  it("leaves out a tool that is no longer published", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("user"));
    vi.mocked(getCatalogTools).mockResolvedValue([printer]);
    const element = await SignedInProjectWorkMap({ tools: refs });
    render(element!);
    expect(screen.getByText("The 1 tool this project used is in one zone of the lab.")).toBeInTheDocument();
    expect(screen.queryByText("Trotec")).toBeNull();
  });
});
