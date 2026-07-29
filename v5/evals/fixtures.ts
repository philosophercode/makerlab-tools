import { mockTools } from "@/components/mock-catalog";
import type { MakerLabTool } from "@/components/catalog-types";

/**
 * Eval fixtures (design spec §3). The eval suite runs with every `NOTION_*`
 * variable unset, so `getCatalogTools()` serves `src/components/mock-catalog.ts`
 * — a fixed, two-machine catalog. This module pins that same data into the
 * shape the assertions need, so an assertion can name exact values instead of
 * guessing what the live catalog happens to contain today.
 *
 * Everything here is pure data derived from the mock catalog plus two small
 * hand-maintained lists:
 *
 *  - {@link EXTRA_ALIASES} — other names a catalog machine legitimately goes by
 *    (manufacturer, short form). Without these, `no_unknown_tools` would flag
 *    "Formlabs" as an invented machine even though it is the Form 4's maker.
 *  - {@link EQUIPMENT_LEXICON} — makerspace brand/model names worth policing.
 *    A token from this list appearing in an answer must resolve to a catalog
 *    machine, otherwise the assistant is talking about equipment the lab does
 *    not have. **This list is the teeth of `no_unknown_tools`** — when the
 *    assistant starts hallucinating a new brand, add it here.
 *
 * Nothing in this file performs I/O.
 */

/** A resource (SOP, safety sheet, manual) linked from a catalog machine. */
export interface EvalFixtureResource {
  label: string;
  href: string;
  kind?: string;
}

/** One catalog machine, flattened for assertions. */
export interface EvalFixtureTool {
  id: string;
  slug: string;
  name: string;
  /** Name plus any other names this machine legitimately goes by. */
  aliases: string[];
  /** Known values per spec field, keyed by the field names in {@link SPEC_FIELDS}. */
  specs: Record<string, string[]>;
  resources: EvalFixtureResource[];
}

/** Everything the assertion vocabulary needs to judge an answer. */
export interface EvalFixture {
  tools: EvalFixtureTool[];
  /** Every catalog slug — link targets are checked against this. */
  slugs: string[];
  /** Every catalog name and alias, across all machines. */
  aliases: string[];
  /** Equipment names worth policing (see {@link EQUIPMENT_LEXICON}). */
  equipmentLexicon: string[];
  /** Spec field → the phrases that signal the answer is talking about it. */
  specFieldKeywords: Record<string, string[]>;
}

/**
 * A spec field an eval can hold the assistant to. `keywords` decide which
 * sentences of an answer are "about" the field; `values` says what the fixture
 * actually knows. **A field with no values is the interesting case**: the mock
 * catalog publishes no build volume, so any number the assistant attributes to
 * one is invented.
 */
interface SpecField {
  keywords: string[];
  values: (tool: MakerLabTool) => string[];
}

/** The spec fields an eval case may name in `no_fabricated_specs`. */
export const SPEC_FIELDS: Record<string, SpecField> = {
  build_volume: {
    keywords: ["build volume", "build area", "build size", "print volume", "bed size", "build platform"],
    // The catalog records no build volume, so every number is a fabrication.
    values: () => [],
  },
  laser_power: {
    keywords: ["laser power", "wattage", "watts", "w laser", "tube power"],
    values: () => [],
  },
  resolution: {
    keywords: ["resolution", "layer height", "micron", "microns", "dpi"],
    values: () => [],
  },
  speed: {
    keywords: ["cutting speed", "print speed", "ipm", "mm/s"],
    values: () => [],
  },
  price: {
    keywords: ["price", "cost", "how much does it cost"],
    values: () => [],
  },
  materials: {
    keywords: ["material", "materials", "stock"],
    values: (tool) => tool.materials,
  },
  ppe: {
    keywords: ["ppe", "protective equipment", "gloves", "safety glasses", "wear"],
    values: (tool) => tool.ppe,
  },
  training: {
    keywords: ["training", "checkout", "authorization", "authorized"],
    values: (tool) => [tool.trainingLevel, tool.trainingLabel],
  },
  location: {
    keywords: ["located", "location", "room", "zone", "bay", "bench"],
    values: (tool) => [tool.location, tool.zone],
  },
  serial: {
    keywords: ["serial", "asset tag"],
    values: (tool) => tool.units.map((unit) => unit.serial),
  },
  date_acquired: {
    keywords: ["acquired", "purchased", "bought"],
    values: (tool) => tool.units.map((unit) => unit.dateAcquired ?? ""),
  },
};

/** Additional legitimate names for catalog machines, keyed by slug. */
const EXTRA_ALIASES: Record<string, string[]> = {
  "form-4": ["Formlabs", "Formlabs Form 4", "Form4"],
  "trotec-speedy-400": ["Trotec", "Speedy 400"],
};

/**
 * Makerspace equipment names the assistant might plausibly reach for. Any of
 * these appearing in an answer must resolve to a catalog machine (via name or
 * alias) unless the sentence is denying that the lab has it.
 */
export const EQUIPMENT_LEXICON: string[] = [
  // Present in the fixture catalog — listed so the check is exercised in the
  // positive direction too.
  "Trotec",
  "Formlabs",
  "Form 4",
  // 3D printing
  "Prusa",
  "Bambu",
  "Bambu Lab",
  "X1-Carbon",
  "Ultimaker",
  "MakerBot",
  "Creality",
  "Ender",
  "Anycubic",
  "Elegoo",
  "Raise3D",
  "Snapmaker",
  "Markforged",
  "Stratasys",
  // Lasers
  "Glowforge",
  "Epilog",
  "Universal Laser",
  "Boss Laser",
  "xTool",
  // Subtractive / other
  "Shapeoko",
  "Onefinity",
  "X-Carve",
  "Tormach",
  "Haas",
  "Bridgeport",
  "OMAX",
  "Wazer",
  "Cricut",
  "Silhouette",
  "Roland",
  "Zund",
  // Machine classes the lab does not have
  "waterjet",
  "water jet",
  "plasma cutter",
  "vinyl cutter",
  "injection molder",
  "CNC router",
  "CNC mill",
];

/** Flatten one catalog machine into its assertion-facing shape. */
function toFixtureTool(tool: MakerLabTool): EvalFixtureTool {
  const specs: Record<string, string[]> = {};
  for (const [field, definition] of Object.entries(SPEC_FIELDS)) {
    specs[field] = definition.values(tool).filter(Boolean);
  }

  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    aliases: [tool.name, ...(EXTRA_ALIASES[tool.slug] ?? [])],
    specs,
    resources: tool.links.map((link) => ({
      label: link.label,
      href: link.href,
      kind: link.kind,
    })),
  };
}

/** Build the fixture from a catalog (defaults to the mock catalog). */
export function buildFixture(tools: MakerLabTool[] = mockTools): EvalFixture {
  const fixtureTools = tools.map(toFixtureTool);

  return {
    tools: fixtureTools,
    slugs: fixtureTools.map((tool) => tool.slug),
    aliases: fixtureTools.flatMap((tool) => tool.aliases),
    equipmentLexicon: EQUIPMENT_LEXICON,
    specFieldKeywords: Object.fromEntries(
      Object.entries(SPEC_FIELDS).map(([field, definition]) => [field, definition.keywords])
    ),
  };
}

/** The fixture the runner uses: the mock catalog, pinned. */
export const evalFixture: EvalFixture = buildFixture();
