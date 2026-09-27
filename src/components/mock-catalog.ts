import type { MakerLabTool, MakerLabUnit } from "./catalog-types";

interface MockSeed {
  id: string;
  slug: string;
  name: string;
  category: string;
  categorySub: string;
  location: string;
  zone: string;
  trainingLevel: MakerLabTool["trainingLevel"];
  trainingLabel: string;
  status: MakerLabTool["status"];
  description: string;
  imageSrc: string;
  ppe: string[];
  materials: string[];
  tags: string[];
  emergencyStop: string | null;
  useRestrictions: string | null;
  mapId: string | null;
  notes: string | null;
  links: MakerLabTool["links"];
  units: MakerLabUnit[];
}

const seeds: MockSeed[] = [
  {
    id: "tool-form-4",
    slug: "form-4",
    name: "Form 4",
    category: "3D Printing",
    categorySub: "Resin",
    location: "MakerLab",
    zone: "Resin Bench",
    trainingLevel: "Intermediate",
    trainingLabel: "Intermediate checkout required",
    status: "In Use",
    description:
      "A production-grade resin printer used for detailed parts that need smooth surfaces, tight tolerances, or engineering material properties. Requires resin handling discipline, post-processing, and ventilation awareness.",
    imageSrc: "/tool-images/Form 4.png",
    ppe: ["Nitrile gloves", "Safety glasses", "Lab coat"],
    materials: ["Standard resin", "Tough resin", "Flexible resin", "Dental resin"],
    tags: ["Resin", "SLA", "Prototyping"],
    emergencyStop: "Lift the lid to immediately halt the print and pause the build.",
    useRestrictions: "Resin handling training required before first print.",
    mapId: "ML-RESIN-01",
    notes: "Always wear nitrile gloves when handling uncured resin. Ventilation must be running.",
    links: [
      { label: "Form 4 SOP", href: "#", kind: "SOP" },
      { label: "Resin handling safety", href: "#", kind: "Safety" },
    ],
    units: [
      {
        id: "unit-form-4-a",
        name: "Form 4 // A",
        serial: "ML-F4-001",
        status: "In Use",
        condition: "Excellent",
        location: "Resin Bench",
        dateAcquired: "2024-08-12",
      },
    ],
  },
  {
    id: "tool-trotec-speedy-400",
    slug: "trotec-speedy-400",
    name: "Trotec Speedy 400",
    category: "Laser",
    categorySub: "CO2",
    location: "Laser Room",
    zone: "Laser Bay",
    trainingLevel: "Advanced",
    trainingLabel: "Advanced authorization required",
    status: "Available",
    description:
      "Large format laser platform for cutting and engraving approved flat stock. Users must verify material compatibility, ventilation, fire watch, and job setup before operation.",
    imageSrc: "/tool-images/Trotec Speedy 400, 80w.png",
    ppe: ["Safety glasses", "Fire watch", "Approved materials only"],
    materials: ["Acrylic", "Paper", "Cardboard", "Plywood"],
    tags: ["Laser", "CO2", "Cutting", "Engraving"],
    emergencyStop: "Press the red E-stop on the right side of the gantry to cut power instantly.",
    useRestrictions: "Authorized users only. Material list must be confirmed with staff.",
    mapId: "ML-LSR-400",
    notes: "Run exhaust for 60 seconds after cuts before opening the lid.",
    links: [
      { label: "Trotec Speedy 400 SOP", href: "#", kind: "SOP" },
      { label: "Approved material list", href: "#", kind: "Safety" },
    ],
    units: [
      {
        id: "unit-trotec-400",
        name: "Trotec Speedy 400",
        serial: "ML-LSR-400",
        status: "Available",
        condition: "Good",
        location: "Laser Bay",
        dateAcquired: "2022-04-03",
      },
    ],
  },
];

export const mockTools: MakerLabTool[] = seeds.map((seed) => ({
  ...seed,
  shortDescription: seed.description,
}));

export function getToolBySlug(slug: string) {
  return mockTools.find((tool) => tool.slug === slug);
}

export function getCategories() {
  return Array.from(new Set(mockTools.map((tool) => tool.category)));
}
