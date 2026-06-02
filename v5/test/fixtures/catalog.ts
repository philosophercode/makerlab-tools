// Ready-made MakerLabTool / MakerLabUnit fixtures for component + integration
// tests. These are the *resolved* domain objects (the shape getCatalogTools
// returns), not raw Notion pages — use test/fixtures/notion.ts for the Notion
// API layer.
import type {
  MakerLabTool,
  MakerLabUnit,
} from "@/components/catalog-types";

const availableUnit: MakerLabUnit = {
  id: "unit-available",
  name: "Form 4 #1",
  serial: "ML-F4-001",
  status: "Available",
  condition: "Excellent",
  location: "Resin Bench",
  dateAcquired: "2024-08-12",
};

const inUseUnit: MakerLabUnit = {
  id: "unit-in-use",
  name: "Prusa #1",
  serial: "ML-PR-001",
  status: "In Use",
  condition: "Good",
  location: "FDM Bench",
  dateAcquired: "2023-01-15",
};

const offlineUnit: MakerLabUnit = {
  id: "unit-offline",
  name: "Trotec #1",
  serial: "ML-LSR-001",
  status: "Offline",
  condition: "Offline",
  location: "Laser Bay",
  dateAcquired: "2022-04-03",
};

/** A simple Available tool (training not required), no units. */
export const availableTool: MakerLabTool = {
  id: "tool-available",
  slug: "bandsaw",
  name: "Bandsaw",
  category: "Woodworking",
  categorySub: "Cutting",
  location: "Wood Shop",
  zone: "Cutting Bay",
  trainingLevel: "Beginner",
  trainingLabel: "Beginner orientation",
  status: "Available",
  shortDescription: "A floor-standing bandsaw for curved cuts in wood.",
  description: "A floor-standing bandsaw for curved cuts in wood.",
  imageSrc: "/tool-images/Bandsaw.png",
  ppe: ["Safety glasses"],
  materials: ["Plywood", "Hardwood"],
  tags: ["Woodworking", "Cutting"],
  emergencyStop: "Press the red paddle to stop the blade.",
  useRestrictions: null,
  mapId: "WS-BAND-01",
  notes: null,
  links: [],
  units: [availableUnit],
};

/** An In-Use tool with multiple units (one in use, one available). */
export const inUseTool: MakerLabTool = {
  id: "tool-in-use",
  slug: "prusa-mk4",
  name: "Prusa MK4",
  category: "3D Printing",
  categorySub: "FDM",
  location: "MakerLab",
  zone: "FDM Bench",
  trainingLevel: "Intermediate",
  trainingLabel: "Intermediate checkout required",
  status: "In Use",
  shortDescription: "A reliable FDM printer for PLA and PETG prototyping.",
  description: "A reliable FDM printer for PLA and PETG prototyping.",
  imageSrc: "/tool-images/Prusa MK4.png",
  ppe: ["Safety glasses"],
  materials: ["PLA", "PETG"],
  tags: ["FDM", "Prototyping"],
  emergencyStop: null,
  useRestrictions: "Complete the FDM orientation before first use.",
  mapId: "ML-FDM-01",
  notes: "Bed adhesion can be finicky — clean with IPA between prints.",
  links: [],
  units: [
    inUseUnit,
    { ...availableUnit, id: "unit-in-use-b", name: "Prusa #2" },
  ],
};

/** An Offline tool (all units offline). */
export const offlineTool: MakerLabTool = {
  id: "tool-offline",
  slug: "trotec-speedy-400",
  name: "Trotec Speedy 400",
  category: "Laser",
  categorySub: "CO2",
  location: "Laser Room",
  zone: "Laser Bay",
  trainingLevel: "Advanced",
  trainingLabel: "Advanced authorization required",
  status: "Offline",
  shortDescription: "Large-format CO2 laser cutter — currently out of service.",
  description: "Large-format CO2 laser cutter — currently out of service.",
  imageSrc: "/tool-images/Trotec Speedy 400.png",
  ppe: ["Safety glasses", "Fire watch"],
  materials: ["Acrylic", "Plywood"],
  tags: ["Laser", "CO2", "Cutting"],
  emergencyStop: "Press the red E-stop on the right of the gantry.",
  useRestrictions: "Authorized users only.",
  mapId: "ML-LSR-400",
  notes: null,
  links: [],
  units: [offlineUnit],
};

/**
 * A tool with rich links (both a url-kind and a file-kind), PPE, materials,
 * and tags — exercises DetailShell resource rendering and the chat route's
 * manual collection / web_fetch allowedDomains logic.
 */
export const toolWithLinks: MakerLabTool = {
  id: "tool-links",
  slug: "form-4",
  name: "Form 4",
  category: "3D Printing",
  categorySub: "Resin",
  location: "MakerLab",
  zone: "Resin Bench",
  trainingLevel: "Intermediate",
  trainingLabel: "Intermediate checkout required",
  status: "Available",
  shortDescription: "A production-grade resin printer for detailed parts.",
  description: "A production-grade resin printer for detailed parts.",
  imageSrc: "/tool-images/Form 4.png",
  ppe: ["Nitrile gloves", "Safety glasses", "Lab coat"],
  materials: ["Standard resin", "Tough resin", "Flexible resin"],
  tags: ["Resin", "SLA", "Prototyping"],
  emergencyStop: "Lift the lid to immediately halt the print.",
  useRestrictions: "Resin handling training required before first print.",
  mapId: "ML-RESIN-01",
  notes: "Ventilation must be running.",
  links: [
    {
      label: "Form 4 Manual",
      href: "https://example.com/form4-manual.pdf",
      kind: "Manual",
      description: "Manufacturer manual (PDF).",
    },
    {
      label: "Form 4 SOP",
      href: "https://example.com/form4-sop",
      kind: "SOP",
      description: "Standard operating procedure.",
    },
  ],
  units: [availableUnit],
};

/** A small ready-made catalog covering each status. */
export const mockCatalog: MakerLabTool[] = [
  availableTool,
  inUseTool,
  offlineTool,
  toolWithLinks,
];

export { availableUnit, inUseUnit, offlineUnit };
