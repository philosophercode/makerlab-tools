import type { ToolItemKind } from "../db/schema/vocabulary.ts";

/**
 * Where every tool goes in taxonomy v2 (the 2026-09-28 review's "Every tool →
 * new category" and "Old → new"; ⚑ items take the review's suggested place).
 *
 * Three rules, first match wins, all deterministic:
 *
 * 1. **By slug** ({@link TOOL_MOVES}). Slugs never change (data platform spec
 *    §4.4), so this holds after display-name renames. Every tool the review
 *    listed is here.
 * 2. **By name** ({@link NAME_RULES}): tools the review named that the saved
 *    inventory listing did not carry a slug for (added since).
 * 3. **By old category** ({@link OLD_CATEGORY_MOVES}), `group › name`
 *    case-insensitively — anything added later into an old category. The one
 *    old category the review *splits* by tool ("Woodworking › General Hand
 *    Tool") has no default: a tool there that no rule names stays where it is
 *    and is reported as unmapped, for a person to place.
 *
 * Facets ride along: `itemKind` and `parentSlug` set `tools.item_kind` and
 * `tools.parent_tool_id`, only where they are still the defaults (a person's
 * choice is never overwritten). A tool with no `itemKind` is equipment. Keyed
 * on the slug, so they hold whatever the tool is called and whichever of
 * `taxonomy:migrate` and `inventory:cleanup` ran first; a re-run sets any
 * facet still at its default, on a tool that moves or one already placed.
 * The Ryobi ONE+ batteries and chargers are accessories with **no** parent:
 * they serve every ONE+ tool, and `parent_tool_id` names one tool.
 *
 * Pure data, no runtime imports: `scripts/` loads it under plain Node.
 */

export interface ToolMove {
  /** The taxonomy v2 slug the tool goes into. */
  category: string;
  itemKind?: ToolItemKind;
  /** The slug of the tool this one is an accessory of. */
  parentSlug?: string;
}

const accessory = (category: string, parentSlug?: string): ToolMove => ({ category, itemKind: "accessory", ...(parentSlug ? { parentSlug } : {}) });
const consumable = (category: string): ToolMove => ({ category, itemKind: "consumable" });
const fixture = (category: string): ToolMove => ({ category, itemKind: "fixture" });

export const TOOL_MOVES: Readonly<Record<string, ToolMove>> = {
  // 3D Printing
  "bambu-lab-x1-carbon-combo-3d-printer": { category: "fdm-printers" },
  "prusa-i3-mk3s": { category: "fdm-printers" },
  "ultimaker-3": { category: "fdm-printers" },
  "ultimaker-3-extended": { category: "fdm-printers" },
  "ultimaker-s5": { category: "fdm-printers" },
  "form-2": { category: "resin-printers-post-processing" },
  "form-4": { category: "resin-printers-post-processing" },
  "form-wash": { category: "resin-printers-post-processing" },
  "form-cure": { category: "resin-printers-post-processing" },
  "original-prusa-i3-mk3s-enclosure-bundle": accessory("printer-upgrades", "prusa-i3-mk3s"),
  "ultimaker-metal-expansion-kit": accessory("printer-upgrades", "ultimaker-s5"),
  "ultimaker-s5-air-manager": accessory("printer-upgrades", "ultimaker-s5"),
  // Laser Cutting & Engraving (no second level)
  "epilog-helix-24-laser-8000-laser-system": { category: "laser-cutting-engraving" },
  "trotec-speedy-400-80w": { category: "laser-cutting-engraving" },
  // CNC & Waterjet
  "bantam-tools-desktop-cnc-milling-machine": { category: "cnc-mills-routers" },
  "bantam-desktop-pcb-milling-machine-othermill-pro": { category: "cnc-mills-routers" },
  "shopbot-buddy-bt48-l36-x-w76-x-h67": { category: "cnc-mills-routers" },
  "shaper-origin": { category: "cnc-mills-routers" },
  "wazer-waterjet-pro": { category: "waterjet" },
  // Added after the review's listing (the 2026-09-28 cleanup bundle has them):
  // by slug too, so a rename never matters.
  "creality-ender-3-v3-3d-printer": { category: "fdm-printers" },
  "glowforge-aura": { category: "laser-cutting-engraving" },
  "bofa-ad500-fume-extractor": { category: "dust-collection" },
  // Power Tools
  "bosch-gst-150-bce": { category: "saws-cutters" },
  "festool-ps-300-eq-plus-trion-jigsaw": { category: "saws-cutters" },
  "plunge-cut-track-saw-ts-55-req-f-plus": { category: "saws-cutters" },
  "rockwell-bladerunner-x2-rk7323": { category: "saws-cutters" },
  "ryobi-p593-18-volt-one-lithium-ion-cordless-pvc-and-pex-cutter": { category: "saws-cutters" },
  "dewalt-drill-dcd777c2": { category: "drills-drivers" },
  "ryobi-p209d-drill-driver": { category: "drills-drivers" },
  "ryobi-pcl235-one-18v-drill-driver": { category: "drills-drivers" },
  "ryobi-drill-press": { category: "drills-drivers" },
  "dewalt-orbital-sander-dwe6421": { category: "sanders" },
  "skil-multi-detail-sander": { category: "sanders" },
  "wen-benchtop-belt-and-disc-sander-6502t": { category: "sanders" },
  "makita-rt0701c": { category: "routers" },
  "makita-plunge-base": accessory("routers", "makita-rt0701c"),
  "dremel-3000": { category: "rotary-tools" },
  "dremel-workstation-220": { category: "rotary-tools" },
  "ryobi-p322-brad-nailer": { category: "nailers" },
  "ryobi-nail-gun": { category: "nailers" },
  "drill-master-heat-gun": { category: "heat-glue" },
  "heat-gun-truepower-drillmaster": { category: "heat-glue" },
  "ryobi-p305-one-18v-lithium-ion-cordless-hot-glue-gun": { category: "heat-glue" },
  // Hand Tools
  "airaj-hacksaw": { category: "hand-saws" },
  "husky-coping-saw": { category: "hand-saws" },
  "marples-mps10189-japanese-style-pull-saw": { category: "hand-saws" },
  "spear-jackson-traditional-brass-back-tenon-saw-9550b": { category: "hand-saws" },
  "stanley-20-221-10-inch-12-points-per-inch-sharptooth-mini-utility-saw": { category: "hand-saws" },
  "stanley-20-807-10-inch-mini-hack-light-duty-utility-saw": { category: "hand-saws" },
  "stanley-coping-saw": { category: "hand-saws" },
  "stanley-saw-15-206": { category: "hand-saws" },
  "stanley-sharptooth-heavy-duty-saw-15-087": { category: "hand-saws" },
  "suizan-dozuki-dovetail-saw": { category: "hand-saws" },
  "cowryman-router-plane": { category: "planes-spokeshaves" },
  "kootans-spokeshave-planer": { category: "planes-spokeshaves" },
  "stanley-hand-planer-contractor-grade-low-angle": { category: "planes-spokeshaves" },
  "stanley-1-12-137-62-low-angle-sweetheart-jack-plane": { category: "planes-spokeshaves" },
  "hi-spec-16-piece-metal-hand-needle-files-tool-set-kit": { category: "files-bits-fastening" },
  "dewalt-screwdriver-bit-set": { category: "files-bits-fastening" },
  "stanley-heavy-duty-extreme-staple-gun-tr150": { category: "files-bits-fastening" },
  // Electronics
  "aoyue-int-2703a": { category: "soldering" },
  "hakko-fx-888d": { category: "soldering" },
  "weller-wesd51": { category: "soldering" },
  "bga-rework-station": { category: "rework-reflow" },
  "smd-rework-station": { category: "rework-reflow" },
  "infrared-ic-heater": { category: "rework-reflow" },
  "oscilloscope-textronix": { category: "test-measurement" },
  // Textiles, Vinyl & Crafts
  "singer-stylist-7258": { category: "sewing-embroidery" },
  "eversewn-sparrow-x2-sewing-embroidery-machine": { category: "sewing-embroidery" },
  "cricut-maker-3": { category: "vinyl-craft-cutters" },
  "roland-camm-1-gs-24-desktop-vinyl-cutter": { category: "vinyl-craft-cutters" },
  "cricut-easy-press-3": { category: "heat-press" },
  "mayku-form-box-vacuum-former": { category: "forming-foam" },
  "marvey-hotwire-foam-cutter": { category: "forming-foam" },
  // Scanning, XR & Media
  "matter-and-form-3d-scanner": { category: "3d-scanners" },
  "structure-sensor": { category: "3d-scanners" },
  "hp-sprout-j4w72aa-aba": { category: "3d-scanners" },
  "meta-quest-2-vr-headset": { category: "vr-xr" },
  "gopro-7-hero-black": { category: "cameras-mounts" },
  "tripod-with-adapter": accessory("cameras-mounts"),
  "ipad-6th-generation-mr7f2ll-a": { category: "tablets" },
  "apple-pencil": accessory("tablets", "ipad-6th-generation-mr7f2ll-a"),
  // Hosted-only (added on production after the review). No audio category
  // exists; Cameras & Mounts is the nearest media leaf. Propose "Audio & Smart
  // Home" on /admin/taxonomy if more arrive (taxonomy spec, amendment "Facets").
  "apple-homepod-2nd-generation": { category: "cameras-mounts" },
  // Shop Infrastructure & Supplies
  "festool-575267-dust-extractor-ct-midi-hepa": { category: "dust-collection" },
  "wen-woodworking-dust-collector-dc3401": { category: "dust-collection" },
  "fulton-hose-ring-clamp": accessory("dust-collection"),
  "peachtree-woodworking-supply-pvc-hose": accessory("dust-collection"),
  "powertec-hose-coupler-70136": accessory("dust-collection"),
  "ryobi-vacuum-cleaner-p7131": { category: "dust-collection" },
  "dust-masks": consumable("ppe"),
  // Hosted-only. A wall-mounted alarm: PPE is the nearest safety leaf, and it
  // is a fixture (installed, never borrowed) rather than equipment.
  "nest-protect-smoke-and-co-alarm": fixture("ppe"),
  "festool-bench": fixture("benches-carts"),
  "woodworking-tools-storage-bench": fixture("benches-carts"),
  "plywood-stacking-rolling-cart": fixture("benches-carts"),
  "valley-craft-a-frame-bin-cart": fixture("benches-carts"),
  "dewalt-dcb107-12v-20v-max-lithium-ion-charger": accessory("batteries-chargers"),
  "ryobi-p117-dual-chemistry-12v-18v-battery-charger-replacement": accessory("batteries-chargers"),
  "ryobi-one-18v-lithium-ion-charger-pcg002": accessory("batteries-chargers"),
  "ryobi-one-18v-lithium-ion-1-5-ah-battery-pbp002": accessory("batteries-chargers"),
  "ryobi-one-18v-lithium-ion-3-0-ah-battery-p103": accessory("batteries-chargers"),
  "ryobi-one-18v-lithium-ion-4-ah-battery-pbp004": accessory("batteries-chargers"),
  "hercules-sanding-sheets": consumable("consumables"),
  "suizan-replacement-blade": consumable("consumables"),
  "brother-compact-monochrome-laser-printer": { category: "office" },
  "label-maker-ac-adapter": accessory("office"),
};

/** Tools the review names whose slugs the saved listing did not have: matched on the name. */
export const NAME_RULES: readonly { pattern: RegExp; move: ToolMove }[] = [
  { pattern: /\bimpact\s+driver\b/i, move: { category: "drills-drivers" } },
  { pattern: /\b(waveshare|e-?paper|e-?ink)\b/i, move: { category: "components-dev-boards" } },
  { pattern: /\bwallboard\b.*\bsaw\b|\bsaw\b.*\bwallboard\b/i, move: { category: "hand-saws" } },
];

/**
 * Old `group › name` (lower-case) → new slug: the review's "Old → new". A null
 * is a split the review decides tool by tool — no default.
 */
export const OLD_CATEGORY_MOVES: Readonly<Record<string, string | null>> = {
  "3d printing › fdm printer": "fdm-printers",
  "3d printing › sla printer": "resin-printers-post-processing",
  "3d printing › post-processing": "resin-printers-post-processing",
  "3d printing › accessory": "printer-upgrades",
  "3d printing › 3d scanner": "3d-scanners",
  "3d printing › vacuum former": "forming-foam",
  "cnc & digital fabrication › cnc mill": "cnc-mills-routers",
  "cnc & digital fabrication › vinyl cutter": "vinyl-craft-cutters",
  "cnc & digital fabrication › waterjet": "waterjet",
  "cnc & digital fabrication › workstation": "benches-carts",
  "electronics › soldering": "soldering",
  "electronics › rework station": "rework-reflow",
  "electronics › test equipment": "test-measurement",
  "electronics › workstation": "rotary-tools",
  "electronics › e-ink display": "components-dev-boards",
  "laser cutting › laser cutter": "laser-cutting-engraving",
  "printing & large format › laser printer": "office",
  "printing & large format › label maker": "office",
  "safety & infrastructure › dust extraction": "dust-collection",
  "safety & infrastructure › hose/accessory": "dust-collection",
  "safety & infrastructure › ppe": "ppe",
  "safety & infrastructure › fume extraction": "dust-collection",
  "laser cutting › fume extractor": "dust-collection",
  "printing & large format › plotter": "office",
  "woodworking › clamp": "files-bits-fastening",
  "scanning & vr › 3d scanner": "3d-scanners",
  "scanning & vr › camera": "cameras-mounts",
  "scanning & vr › tablet/accessory": "tablets",
  "scanning & vr › vr headset": "vr-xr",
  "sewing & textiles › sewing machine": "sewing-embroidery",
  "sewing & textiles › embroidery": "sewing-embroidery",
  "sewing & textiles › embroidery machine": "sewing-embroidery",
  "sewing & textiles › heat press": "heat-press",
  "woodworking › hand saw": "hand-saws",
  "woodworking › plane": "planes-spokeshaves",
  "woodworking › chisel/scraper": "files-bits-fastening",
  "woodworking › power saw": "saws-cutters",
  "woodworking › drill/driver": "drills-drivers",
  "woodworking › sander": "sanders",
  "woodworking › router": "routers",
  "woodworking › nailer/stapler": "nailers",
  "woodworking › accessory": "batteries-chargers",
  "woodworking › general hand tool": null,
};

/** `group › name`, lower-cased and single-spaced — the key {@link OLD_CATEGORY_MOVES} uses. */
export function oldCategoryKey(group: string | null, name: string): string {
  const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return group ? `${clean(group)} › ${clean(name)}` : clean(name);
}

export type MoveRule = "slug" | "name" | "old_category";

/** Where one tool goes, and by which rule — or null when no rule places it. */
export function moveFor(tool: {
  slug: string;
  name: string;
  categoryName: string | null;
  categoryGroup: string | null;
}): { move: ToolMove; rule: MoveRule } | null {
  const bySlug = TOOL_MOVES[tool.slug];
  if (bySlug) return { move: bySlug, rule: "slug" };
  const byName = NAME_RULES.find((rule) => rule.pattern.test(tool.name));
  if (byName) return { move: byName.move, rule: "name" };
  if (tool.categoryName) {
    const target = OLD_CATEGORY_MOVES[oldCategoryKey(tool.categoryGroup, tool.categoryName)];
    if (target) return { move: { category: target }, rule: "old_category" };
  }
  return null;
}
