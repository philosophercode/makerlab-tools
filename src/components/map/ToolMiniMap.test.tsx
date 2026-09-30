import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/utils/render";
import { identityFor } from "../../../test/utils/identities";
import { availableTool } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";

vi.mock("../../lib/auth/identity", () => ({ resolveIdentityFromHeaders: vi.fn() }));

import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { DetailShell } from "../DetailShell";
import { SignedInToolMiniMap } from "./SignedInToolMiniMap";
import { ToolMiniMap } from "./ToolMiniMap";

/** A tool at a zone the Studio 101 plan has. */
const bambu: MakerLabTool = {
  ...availableTool,
  name: "Bambu Lab X1-Carbon",
  location: "Studio 101",
  zone: "3D Printing Hub",
  mapId: null,
};

/** A tool whose location is not on any plan. */
const unplaced: MakerLabTool = { ...availableTool, location: "Unknown", zone: "Unknown", mapId: null };

describe("SignedInToolMiniMap (hero mini-map, map access PR #98)", () => {
  beforeEach(() => vi.mocked(resolveIdentityFromHeaders).mockReset());

  it("sends a signed-out visitor nothing: no link, no plan, no zone", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("anonymous"));
    expect(await SignedInToolMiniMap({ tool: bambu })).toBeNull();
  });

  it("shows a signed-in visitor the plan with the tool's zone lit, as one link to the full map", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("user"));
    const element = await SignedInToolMiniMap({ tool: bambu });
    expect(element).not.toBeNull();
    const { container } = render(element!);
    const link = screen.getByRole("link", { name: "Where Bambu Lab X1-Carbon is — open map" });
    expect(link).toHaveAttribute("href", "/map?highlight=Z2");
    expect(link).toHaveAttribute("data-slot", "tool-minimap");
    expect(container.querySelector('svg[data-mode="thumbnail"] [data-here="true"]')).not.toBeNull();
    expect(link).toHaveTextContent("Zone 2 · 3D Printing Hub");
  });
});

describe("ToolMiniMap", () => {
  it("draws nothing for a tool that is not on the map", () => {
    const { container } = render(<ToolMiniMap tool={unplaced} />);
    expect(container.querySelector('[data-slot="tool-minimap"]')).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("sits beside the photo in the hero, the photo left untouched", () => {
    const { container } = render(<DetailShell tool={bambu} heroMap={<ToolMiniMap tool={bambu} />} />);
    const media = container.querySelector('[data-slot="tool-hero-media"]') as HTMLElement;
    const [photo, map] = Array.from(media.children);
    expect(photo.querySelector("img")).not.toBeNull();
    expect(photo.className).not.toContain("/hero-media:hidden");
    expect(map).toHaveAttribute("data-slot", "tool-minimap");
  });

  it("stands in for a tool with no photo: the empty plate gives way when the map is there", () => {
    const noPhoto: MakerLabTool = { ...bambu, imageSrc: "", thumbnails: null };
    const { container } = render(<DetailShell tool={noPhoto} heroMap={<ToolMiniMap tool={noPhoto} />} />);
    const plate = container.querySelector('[data-slot="tool-image-empty"]')?.parentElement as HTMLElement;
    expect(plate.className).toContain("group-has-[[data-slot=tool-minimap]]/hero-media:hidden");
    expect(container.querySelector('[data-slot="tool-minimap"]')).not.toBeNull();
  });

  it("keeps the photo plate as it was when there is no map (signed out)", () => {
    const { container } = render(<DetailShell tool={bambu} />);
    const media = container.querySelector('[data-slot="tool-hero-media"]') as HTMLElement;
    expect(media.children).toHaveLength(1);
    expect(container.querySelector('[data-slot="tool-minimap"]')).toBeNull();
  });
});
