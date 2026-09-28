/**
 * The lab's category tree, taxonomy v2 (docs/specs/2026-09-28-taxonomy-v2-design.md
 * §3, from the 2026-09-28 taxonomy review the owner approved).
 *
 * Nine top-level categories by process or shop — never by brand, never
 * "accessory" — each with its second level. Every entry says what belongs
 * and what does not, because research reads these descriptions to choose a
 * category (`slug — Parent › Name: description` in its prompt) and a reviewer
 * reads them on `/admin/taxonomy`.
 *
 * This is the **seed**, written by `npm run taxonomy:migrate`. After that the
 * database is the source of truth: `/admin/taxonomy` renames, retires and
 * merges, and accepted proposals add. The migration never overwrites a name or
 * description somebody has since edited (it only fills blanks).
 *
 * Pure data, no imports: `scripts/` loads it under plain Node.
 */

export interface TaxonomyNode {
  slug: string;
  name: string;
  description: string;
  /** Left out of the public gallery by default; children inherit it. */
  galleryHidden?: boolean;
  children?: TaxonomyNode[];
}

export const TAXONOMY_TREE: readonly TaxonomyNode[] = [
  {
    slug: "3d-printing",
    name: "3D Printing",
    description:
      "Machines that build parts layer by layer, plus their post-processing stations and printer add-ons. Not 3D scanners (Scanning, XR & Media) or vacuum formers (Textiles, Vinyl & Crafts).",
    children: [
      {
        slug: "fdm-printers",
        name: "FDM Printers",
        description: "Filament (FDM/FFF) printers that extrude plastic. Not resin printers or printer add-ons.",
      },
      {
        slug: "resin-printers-post-processing",
        name: "Resin Printers & Post-Processing",
        description:
          "Resin (SLA/MSLA/DLP) printers and the wash and cure stations that finish their prints. Not FDM printers.",
      },
      {
        slug: "printer-upgrades",
        name: "Printer Upgrades",
        description:
          "Kits and add-ons that attach to one of the lab's printers — enclosures, print-core kits, air managers. Record the printer as the parent tool. Not filament or resin (supplies).",
      },
    ],
  },
  {
    slug: "laser-cutting-engraving",
    name: "Laser Cutting & Engraving",
    description:
      "CO2 and fibre laser cutters and engravers. Not vinyl or craft cutters (Textiles, Vinyl & Crafts) or waterjets (CNC & Waterjet).",
  },
  {
    slug: "cnc-waterjet",
    name: "CNC & Waterjet",
    description:
      "Computer-controlled subtractive machines: CNC mills and routers, PCB mills, handheld CNC and waterjet cutters. Not laser cutters or hand-guided power routers (Power Tools).",
    children: [
      {
        slug: "cnc-mills-routers",
        name: "CNC Mills & Routers",
        description:
          "Desktop and bed CNC mills, CNC routers, PCB mills and computer-guided handheld routers. Not handheld power routers without CNC control.",
      },
      {
        slug: "waterjet",
        name: "Waterjet",
        description: "Abrasive waterjet cutters. Not laser or CNC routers.",
      },
    ],
  },
  {
    slug: "power-tools",
    name: "Power Tools",
    description:
      "Handheld and benchtop tools driven by a motor or heater, corded or cordless. Not batteries and chargers (Shop Infrastructure & Supplies) or CNC machines.",
    children: [
      {
        slug: "saws-cutters",
        name: "Saws & Cutters",
        description: "Powered saws and cutters: jigsaws, track and circular saws, scroll saws, pipe cutters. Not hand saws or hot-wire foam cutters.",
      },
      {
        slug: "drills-drivers",
        name: "Drills & Drivers",
        description: "Drill/drivers, impact drivers and drill presses. Not bit sets (Hand Tools) or rotary tools.",
      },
      {
        slug: "sanders",
        name: "Sanders",
        description: "Orbital, detail, belt and disc sanders. Not sanding sheets or discs (Consumables).",
      },
      {
        slug: "routers",
        name: "Routers",
        description: "Handheld trim and plunge routers and their bases. Not CNC routers (CNC & Waterjet) or router planes (Hand Tools).",
      },
      {
        slug: "rotary-tools",
        name: "Rotary Tools",
        description: "Dremel-style rotary tools and their stands and workstations. Not drills.",
      },
      {
        slug: "nailers",
        name: "Nailers",
        description: "Powered brad and finish nailers. Not manual staple guns (Hand Tools).",
      },
      {
        slug: "heat-glue",
        name: "Heat & Glue",
        description: "Heat guns and hot-glue guns. Not soldering or rework stations (Electronics) or heat presses.",
      },
    ],
  },
  {
    slug: "hand-tools",
    name: "Hand Tools",
    description:
      "Tools powered by hand: saws, planes, files, bit sets and manual fastening. Not anything with a motor (Power Tools).",
    children: [
      {
        slug: "hand-saws",
        name: "Hand Saws",
        description: "Pull, coping, tenon, dovetail, hack and utility saws. Not replacement blades (Consumables) or powered saws.",
      },
      {
        slug: "planes-spokeshaves",
        name: "Planes & Spokeshaves",
        description: "Bench, block and router planes and spokeshaves. Not powered routers or plunge bases (Power Tools).",
      },
      {
        slug: "files-bits-fastening",
        name: "Files, Bits & Fastening",
        description: "File and rasp sets, screwdriver bit sets, clamps and manual staple guns. Not powered nailers.",
      },
    ],
  },
  {
    slug: "electronics",
    name: "Electronics",
    description:
      "Soldering, rework, test and measurement, and the components and dev boards students build with. Not rotary tools or PCB mills (CNC & Waterjet).",
    children: [
      {
        slug: "soldering",
        name: "Soldering",
        description: "Soldering stations and irons. Not hot-air or infrared rework stations.",
      },
      {
        slug: "rework-reflow",
        name: "Rework & Reflow",
        description: "Hot-air, BGA and SMD rework stations, infrared heaters and reflow ovens. Not soldering irons.",
      },
      {
        slug: "test-measurement",
        name: "Test & Measurement",
        description: "Oscilloscopes, multimeters, power supplies and logic analysers.",
      },
      {
        slug: "components-dev-boards",
        name: "Components & Dev Boards",
        description: "Microcontrollers, single-board computers, displays, HATs and other parts for building circuits.",
      },
    ],
  },
  {
    slug: "textiles-vinyl-crafts",
    name: "Textiles, Vinyl & Crafts",
    description:
      "Sewing and embroidery, vinyl and craft cutters, heat presses, and forming (vacuum forming, hot-wire foam). Not laser cutters.",
    children: [
      {
        slug: "sewing-embroidery",
        name: "Sewing & Embroidery",
        description: "Sewing, serger and embroidery machines.",
      },
      {
        slug: "vinyl-craft-cutters",
        name: "Vinyl & Craft Cutters",
        description: "Blade plotters and craft cutters (Cricut, Roland). Not laser cutters.",
      },
      {
        slug: "heat-press",
        name: "Heat Press",
        description: "Heat presses for transfers and vinyl. Not heat guns (Power Tools).",
      },
      {
        slug: "forming-foam",
        name: "Forming & Foam",
        description: "Vacuum formers and hot-wire foam cutters.",
      },
    ],
  },
  {
    slug: "scanning-xr-media",
    name: "Scanning, XR & Media",
    description:
      "Capturing and presenting the physical world: 3D scanners, VR/XR headsets, cameras and mounts, and tablets. Not computers for general use.",
    children: [
      {
        slug: "3d-scanners",
        name: "3D Scanners",
        description: "Turntable, handheld and depth-sensor 3D scanners and scanning workstations.",
      },
      {
        slug: "vr-xr",
        name: "VR/XR",
        description: "VR, AR and mixed-reality headsets and their controllers.",
      },
      {
        slug: "cameras-mounts",
        name: "Cameras & Mounts",
        description: "Action and video cameras, tripods and mounts.",
      },
      {
        slug: "tablets",
        name: "Tablets",
        description: "Tablets and their styluses, for drawing and design.",
      },
    ],
  },
  {
    slug: "shop-infrastructure-supplies",
    name: "Shop Infrastructure & Supplies",
    description:
      "What keeps the shop running rather than what students make with: dust collection, PPE, benches and carts, batteries and chargers, consumables and office equipment. Hidden from the public gallery by default; staff and the assistant still see it.",
    galleryHidden: true,
    children: [
      {
        slug: "dust-collection",
        name: "Dust Collection",
        description: "Dust extractors and collectors, fume extractors, shop vacuums, and their hoses, clamps and fittings.",
      },
      {
        slug: "ppe",
        name: "PPE",
        description: "Personal protective equipment: masks, respirators, glasses, gloves, hearing protection.",
      },
      {
        slug: "benches-carts",
        name: "Benches & Carts",
        description: "Workbenches, storage benches, material carts and bin carts.",
      },
      {
        slug: "batteries-chargers",
        name: "Batteries & Chargers",
        description: "Cordless tool batteries and chargers (Ryobi ONE+, DeWalt 20V). Not the tools that use them.",
      },
      {
        slug: "consumables",
        name: "Consumables",
        description: "Things used up: sanding sheets, replacement blades, bits sold as spares.",
      },
      {
        slug: "office",
        name: "Office",
        description: "Paper printers, label makers and their adapters.",
      },
    ],
  },
];

/** A node with its parent's slug: the tree flattened, top-level first then each child, in order. */
export interface FlatTaxonomyNode {
  slug: string;
  name: string;
  description: string;
  parentSlug: string | null;
  sortOrder: number;
  galleryHidden: boolean;
}

/** The tree as rows, in the order `taxonomy:migrate` writes them (parents before children). */
export function flattenTree(tree: readonly TaxonomyNode[] = TAXONOMY_TREE): FlatTaxonomyNode[] {
  const out: FlatTaxonomyNode[] = [];
  tree.forEach((node, index) => {
    out.push({
      slug: node.slug,
      name: node.name,
      description: node.description,
      parentSlug: null,
      sortOrder: (index + 1) * 10,
      galleryHidden: Boolean(node.galleryHidden),
    });
  });
  tree.forEach((node) => {
    (node.children ?? []).forEach((child, index) => {
      out.push({
        slug: child.slug,
        name: child.name,
        description: child.description,
        parentSlug: node.slug,
        sortOrder: (index + 1) * 10,
        galleryHidden: Boolean(child.galleryHidden ?? node.galleryHidden),
      });
    });
  });
  return out;
}
