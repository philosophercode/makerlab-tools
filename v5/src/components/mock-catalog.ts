import type { MakerLabTool } from "./catalog-types";

export const mockTools: MakerLabTool[] = [
  {
    id: "tool-form-4",
    slug: "form-4",
    name: "Form 4",
    category: "3D Printing",
    location: "MakerLab",
    zone: "Resin Bench",
    trainingLevel: "Intermediate",
    status: "In Use",
    shortDescription:
      "High-resolution SLA resin printer for precise prototypes, fixtures, and small batch parts.",
    description:
      "A production-grade resin printer used for detailed parts that need smooth surfaces, tight tolerances, or engineering material properties. Requires resin handling discipline, post-processing, and ventilation awareness.",
    imageSrc: "/tool-images/Form 4.png",
    ppe: ["Nitrile gloves", "Safety glasses", "Lab coat"],
    specs: [
      { label: "Process", value: "SLA resin printing" },
      { label: "Build volume", value: "200 x 125 x 210 mm" },
      { label: "Materials", value: "Standard, Tough, Flexible, Dental resins" },
      { label: "Training", value: "Intermediate checkout required" },
    ],
    links: [
      { label: "SOP", href: "#" },
      { label: "Manual", href: "#" },
      { label: "Resin handling", href: "#" },
    ],
    units: [
      {
        id: "unit-form-4-a",
        name: "Form 4 // A",
        serial: "ML-F4-001",
        status: "In Use",
        condition: "Excellent",
        location: "Resin Bench",
      },
      {
        id: "unit-form-4-b",
        name: "Form 4 // B",
        serial: "ML-F4-002",
        status: "Available",
        condition: "Good",
        location: "Resin Bench",
      },
    ],
  },
  {
    id: "tool-trotec-speedy-400",
    slug: "trotec-speedy-400",
    name: "Trotec Speedy 400",
    category: "Laser",
    location: "Laser Room",
    zone: "Laser Bay",
    trainingLevel: "Advanced",
    status: "Available",
    shortDescription:
      "80W CO2 laser cutter and engraver for sheet goods, paper, acrylic, and approved woods.",
    description:
      "Large format laser platform for cutting and engraving approved flat stock. Users must verify material compatibility, ventilation, fire watch, and job setup before operation.",
    imageSrc: "/tool-images/Trotec Speedy 400, 80w.png",
    ppe: ["Safety glasses", "Fire watch", "Approved materials only"],
    specs: [
      { label: "Laser", value: "80W CO2" },
      { label: "Bed", value: "1000 x 610 mm" },
      { label: "Materials", value: "Acrylic, paper, cardboard, plywood" },
      { label: "Training", value: "Advanced authorization required" },
    ],
    links: [
      { label: "SOP", href: "#" },
      { label: "Material list", href: "#" },
      { label: "Job setup", href: "#" },
    ],
    units: [
      {
        id: "unit-trotec-400",
        name: "Trotec Speedy 400",
        serial: "ML-LSR-400",
        status: "Available",
        condition: "Good",
        location: "Laser Bay",
      },
    ],
  },
  {
    id: "tool-bantam-cnc",
    slug: "bantam-cnc",
    name: "Bantam Desktop CNC",
    category: "CNC",
    location: "Electronics Bench",
    zone: "PCB Station",
    trainingLevel: "Advanced",
    status: "Training Required",
    shortDescription:
      "Compact CNC mill for PCBs, small aluminum parts, wax, plastics, and precision fixtures.",
    description:
      "Desktop CNC platform suited for electronics workflows and small mechanical parts. Requires CAM review, toolpath setup, stock fixturing, and supervised first run.",
    imageSrc: "/tool-images/Bantam Tools Desktop CNC Milling Machine.png",
    ppe: ["Safety glasses", "Hearing protection", "Closed-toe shoes"],
    specs: [
      { label: "Process", value: "3-axis subtractive milling" },
      { label: "Materials", value: "FR-1, wax, plastic, aluminum" },
      { label: "Workholding", value: "Tape, clamps, low-profile vises" },
      { label: "Training", value: "Advanced checkout required" },
    ],
    links: [
      { label: "SOP", href: "#" },
      { label: "Tool library", href: "#" },
      { label: "CAM notes", href: "#" },
    ],
    units: [
      {
        id: "unit-bantam-a",
        name: "Bantam CNC // A",
        serial: "ML-CNC-012",
        status: "Training Required",
        condition: "Service Soon",
        location: "PCB Station",
      },
    ],
  },
  {
    id: "tool-vinyl-cutter",
    slug: "roland-vinyl-cutter",
    name: "Roland Camm-1 GS-24",
    category: "Vinyl",
    location: "Assembly Studio",
    zone: "Graphics Bench",
    trainingLevel: "Beginner",
    status: "Available",
    shortDescription:
      "Desktop vinyl cutter for decals, masking film, heat-transfer vinyl, and sign graphics.",
    description:
      "Precision drag-knife cutter for sheet and roll vinyl workflows. Good entry point for new lab users after a short orientation on blades, force, and weeding.",
    imageSrc: "/tool-images/Roland Camm-1 GS-24 Desktop Vinyl Cutter.png",
    ppe: ["Blade handling care"],
    specs: [
      { label: "Process", value: "Drag-knife vinyl cutting" },
      { label: "Media", value: "Sheet and roll vinyl" },
      { label: "Width", value: "Up to 24 in" },
      { label: "Training", value: "Beginner orientation" },
    ],
    links: [
      { label: "SOP", href: "#" },
      { label: "CutStudio guide", href: "#" },
    ],
    units: [
      {
        id: "unit-roland-gs24",
        name: "Roland GS-24",
        serial: "ML-VIN-024",
        status: "Available",
        condition: "Excellent",
        location: "Graphics Bench",
      },
    ],
  },
];

export function getToolBySlug(slug: string) {
  return mockTools.find((tool) => tool.slug === slug);
}

export function getCategories() {
  return Array.from(new Set(mockTools.map((tool) => tool.category)));
}
