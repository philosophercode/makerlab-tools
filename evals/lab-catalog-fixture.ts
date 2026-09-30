import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { categories, locations, tools } from "@/lib/db/schema/index";

/**
 * A fuller lab for the photo-identification evals (`cases/photo-identify.yaml`).
 *
 * The demo seed is two machines — a resin printer and a laser — so "which of
 * our machines is in this photo?" would be a coin toss with one side painted
 * on. A student photographs a machine in a lab of dozens, several of them
 * look-alikes, so these cases run against the demo seed **plus** the machines
 * below: three more FDM printers (two Ultimakers that differ mainly in height),
 * a second Formlabs printer, a second laser, a CNC router and a handful of
 * bench tools — every one a machine the real MakerLAB inventory has, with a
 * bundled product image in `public/tool-images` for the photo fixtures.
 *
 * Only cases with `context: { catalog: lab }` see it: `run.eval.ts` runs every
 * other case first, against the two-machine seed their assertions are written
 * for (the honest-absence cases ask about a Bambu Lab X1-Carbon the lab does
 * not have), then seeds this and runs the lab cases. Descriptions are
 * functional, as research writes them — none describes what the machine looks
 * like, so a photo is identified by the machine, not by a hint in the prompt.
 */

export interface LabFixtureTool {
  slug: string;
  name: string;
  officialName?: string;
  /** A category slug from the taxonomy tree the demo seed inserts. */
  category: string;
  room: string;
  zone: string;
  description: string;
  materials?: string[];
  tags?: string[];
  trainingRequired?: boolean;
}

export const LAB_FIXTURE_TOOLS: readonly LabFixtureTool[] = [
  {
    slug: "bambu-lab-x1-carbon",
    name: "Bambu Lab X1-Carbon",
    officialName: "Bambu Lab X1-Carbon Combo 3D Printer",
    category: "fdm-printers",
    room: "MakerLab",
    zone: "Printer Wall",
    description: "A fast CoreXY FDM printer with an automatic material system for up to four filaments, lidar-assisted first-layer inspection and automatic bed levelling.",
    materials: ["PLA", "PETG", "ABS", "TPU", "Carbon-fibre filaments"],
    tags: ["FDM", "Multi-material"],
    trainingRequired: true,
  },
  {
    slug: "prusa-i3-mk3s-plus",
    name: "Prusa i3 MK3S+",
    officialName: "Original Prusa i3 MK3S+",
    category: "fdm-printers",
    room: "MakerLab",
    zone: "Printer Wall",
    description: "A reliable single-extruder FDM printer with a removable spring-steel sheet, filament sensor and power-panic recovery. Good for everyday PLA and PETG parts.",
    materials: ["PLA", "PETG", "ASA"],
    tags: ["FDM"],
    trainingRequired: true,
  },
  {
    slug: "ultimaker-s5",
    name: "Ultimaker S5",
    category: "fdm-printers",
    room: "MakerLab",
    zone: "Printer Wall",
    description: "A dual-extrusion FDM printer with a large build volume and swappable print cores, used for water-soluble supports and engineering materials.",
    materials: ["PLA", "Tough PLA", "Nylon", "PVA"],
    tags: ["FDM", "Dual extrusion"],
    trainingRequired: true,
  },
  {
    slug: "ultimaker-3",
    name: "Ultimaker 3",
    category: "fdm-printers",
    room: "MakerLab",
    zone: "Printer Wall",
    description: "A dual-extrusion FDM printer with swappable print cores and water-soluble PVA supports.",
    materials: ["PLA", "PVA", "Nylon"],
    tags: ["FDM", "Dual extrusion"],
    trainingRequired: true,
  },
  {
    slug: "ultimaker-3-extended",
    name: "Ultimaker 3 Extended",
    category: "fdm-printers",
    room: "MakerLab",
    zone: "Printer Wall",
    description: "The taller version of the Ultimaker 3: the same dual-extrusion FDM printer with more build height.",
    materials: ["PLA", "PVA", "Nylon"],
    tags: ["FDM", "Dual extrusion"],
    trainingRequired: true,
  },
  {
    slug: "form-2",
    name: "Form 2",
    officialName: "Formlabs Form 2",
    category: "resin-printers-post-processing",
    room: "MakerLab",
    zone: "Resin Bench",
    description: "An earlier-generation SLA resin printer for detailed parts. Needs the same resin handling and post-processing as any resin printer.",
    materials: ["Standard resin", "Tough resin"],
    tags: ["Resin", "SLA"],
    trainingRequired: true,
  },
  {
    slug: "epilog-helix-24",
    name: "Epilog Helix 24",
    officialName: "Epilog Helix 24 Laser (8000 Laser System)",
    category: "laser-cutting-engraving",
    room: "Laser Room",
    zone: "Laser Bay",
    description: "A CO2 laser cutter and engraver for approved sheet materials such as wood, acrylic, paper and leather.",
    materials: ["Acrylic", "Plywood", "Paper", "Leather"],
    tags: ["Laser", "CO2", "Engraving"],
    trainingRequired: true,
  },
  {
    slug: "shopbot-buddy-bt48",
    name: "ShopBot Buddy BT48",
    category: "cnc-mills-routers",
    room: "Wood Shop",
    zone: "CNC Bay",
    description: "A CNC router for cutting and carving sheet goods such as plywood, MDF and foam. Staff-supervised; toolpaths must be reviewed before cutting.",
    materials: ["Plywood", "MDF", "Hardwood", "Foam"],
    tags: ["CNC", "Router"],
    trainingRequired: true,
  },
  {
    slug: "dremel-3000",
    name: "Dremel 3000",
    category: "rotary-tools",
    room: "MakerLab",
    zone: "Hand Tool Wall",
    description: "A variable-speed corded rotary tool for sanding, grinding, polishing and small cuts.",
    tags: ["Rotary tool"],
  },
  {
    slug: "cricut-maker-3",
    name: "Cricut Maker 3",
    category: "vinyl-craft-cutters",
    room: "MakerLab",
    zone: "Craft Table",
    description: "A cutting machine for vinyl, paper, card, fabric and thin materials, driven from Cricut Design Space.",
    materials: ["Vinyl", "Paper", "Cardstock", "Fabric"],
    tags: ["Cutting"],
  },
  {
    slug: "hakko-fx-888d",
    name: "HAKKO FX-888D",
    category: "soldering",
    room: "Electronics Lab",
    zone: "Soldering Bench",
    description: "A digital temperature-controlled soldering station for through-hole and surface-mount work.",
    tags: ["Soldering", "Electronics"],
  },
  {
    slug: "mayku-formbox",
    name: "Mayku FormBox",
    category: "forming-foam",
    room: "MakerLab",
    zone: "Craft Table",
    description: "A desktop vacuum former that pulls heated plastic sheet over a mould, powered by a household vacuum cleaner.",
    materials: ["HIPS sheet", "PETG sheet"],
    tags: ["Vacuum forming"],
  },
  {
    slug: "singer-stylist-7258",
    name: "Singer Stylist 7258",
    category: "sewing-embroidery",
    room: "MakerLab",
    zone: "Craft Table",
    description: "A computerised sewing machine with 100 stitch patterns and an automatic needle threader.",
    materials: ["Cotton", "Fabric"],
    tags: ["Sewing"],
  },
];

/** Every slug the lab fixture adds. */
export const LAB_FIXTURE_SLUGS = LAB_FIXTURE_TOOLS.map((tool) => tool.slug);

/**
 * Add the lab fixture's machines to the eval's PGlite database, published.
 * Idempotent per process: a second call finds them and returns.
 */
export async function seedEvalLabCatalog(): Promise<void> {
  const db = await getDb();
  const existing = await db.select({ slug: tools.slug }).from(tools).where(inArray(tools.slug, LAB_FIXTURE_SLUGS));
  if (existing.length === LAB_FIXTURE_SLUGS.length) return;
  const have = new Set(existing.map((row) => row.slug));

  const categoryIds = new Map<string, string>();
  for (const slug of new Set(LAB_FIXTURE_TOOLS.map((tool) => tool.category))) {
    const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
    if (!row) throw new Error(`the demo seed's taxonomy has no category "${slug}"`);
    categoryIds.set(slug, row.id);
  }

  const locationIds = new Map<string, string>();
  for (const tool of LAB_FIXTURE_TOOLS) {
    const key = `${tool.room}\u0000${tool.zone}`;
    if (locationIds.has(key)) continue;
    const found = (await db.select({ id: locations.id, room: locations.room, zone: locations.zone }).from(locations)).find(
      (row) => row.room === tool.room && row.zone === tool.zone
    );
    const id = found?.id ?? (await db.insert(locations).values({ room: tool.room, zone: tool.zone }).returning({ id: locations.id }))[0].id;
    locationIds.set(key, id);
  }

  const rows = LAB_FIXTURE_TOOLS.filter((tool) => !have.has(tool.slug)).map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    officialName: tool.officialName ?? null,
    description: tool.description,
    categoryId: categoryIds.get(tool.category)!,
    locationId: locationIds.get(`${tool.room}\u0000${tool.zone}`)!,
    materials: tool.materials ?? [],
    tags: tool.tags ?? [],
    trainingRequired: tool.trainingRequired ?? false,
    published: true,
  }));
  if (rows.length > 0) await db.insert(tools).values(rows);
}
