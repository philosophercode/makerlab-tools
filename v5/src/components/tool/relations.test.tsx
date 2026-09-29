import { render, screen, within } from "../../../test/utils/render";
import { toolWithLinks, inUseTool, offlineTool } from "../../../test/fixtures/catalog";
import { DetailShell } from "../DetailShell";
import { toolRelations } from "./relations";

/** Accessory links on the tool page (taxonomy v2 facets `item_kind`, `parent_tool_id`). */

const router = { ...toolWithLinks, id: "router", slug: "makita-rt0701c", name: "Makita Compact Router", parentToolId: null };
const base = { ...inUseTool, id: "base", slug: "makita-plunge-base", name: "Makita Plunge Base", itemKind: "accessory" as const, parentToolId: "router" };
const guide = { ...offlineTool, id: "guide", slug: "edge-guide", name: "Edge Guide", itemKind: "accessory" as const, parentToolId: "router" };

describe("toolRelations", () => {
  it("names the parent and the accessories, by name, from the published catalogue", () => {
    expect(toolRelations(router, [guide, base, router])).toEqual({
      accessoryOf: null,
      accessories: [
        { slug: "edge-guide", name: "Edge Guide" },
        { slug: "makita-plunge-base", name: "Makita Plunge Base" },
      ],
    });
    expect(toolRelations(base, [guide, base, router])).toEqual({
      accessoryOf: { slug: "makita-rt0701c", name: "Makita Compact Router" },
      accessories: [],
    });
  });

  it("links nothing the catalogue does not hold (a draft or archived parent)", () => {
    expect(toolRelations(base, [base]).accessoryOf).toBeNull();
  });
});

describe("DetailShell accessory links", () => {
  it("says an accessory's kind and links its tool", () => {
    render(<DetailShell tool={base} relations={toolRelations(base, [base, router])} />);
    const specs = document.querySelector('[data-slot="tool-specs"]') as HTMLElement;
    expect(within(specs).getByText("Item kind")).toBeInTheDocument();
    expect(within(specs).getByText("Accessory")).toBeInTheDocument();
    expect(within(specs).getByRole("link", { name: "Makita Compact Router" })).toHaveAttribute("href", "/tools/makita-rt0701c");
  });

  it("lists the parent's accessories", () => {
    render(<DetailShell tool={router} relations={toolRelations(router, [router, base, guide])} />);
    const section = screen.getByRole("region", { name: "Accessories" });
    expect(within(section).getByRole("link", { name: /Makita Plunge Base/ })).toHaveAttribute("href", "/tools/makita-plunge-base");
    expect(within(section).getByRole("link", { name: /Edge Guide/ })).toBeInTheDocument();
  });

  it("draws nothing for equipment with no accessories", () => {
    render(<DetailShell tool={router} relations={toolRelations(router, [router])} />);
    expect(screen.queryByRole("region", { name: "Accessories" })).not.toBeInTheDocument();
    expect(screen.queryByText("Item kind")).not.toBeInTheDocument();
    expect(screen.queryByText("Accessory of")).not.toBeInTheDocument();
  });
});
