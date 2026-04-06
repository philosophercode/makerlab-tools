import type { GalleryCardProps } from "@/lib/types";

export const mockProjects: GalleryCardProps[] = [
  {
    id: "kinetic-lamp",
    title: "Kinetic Desk Lamp",
    description:
      "A motion-reactive lamp built with laser-cut acrylic, a microcontroller, and proximity sensors.",
    imageUrl:
      "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80",
    tools: ["Laser Cutter", "Soldering Station", "3D Printer"],
  },
  {
    id: "modular-planter",
    title: "Modular Smart Planter",
    description:
      "Stackable planter modules with soil moisture telemetry and LED growth indicator strips.",
    imageUrl:
      "https://images.unsplash.com/photo-1463320726281-696a485928c7?auto=format&fit=crop&w=1200&q=80",
    tools: ["CNC Router", "Arduino Kit", "Vinyl Cutter"],
  },
  {
    id: "assistive-grip",
    title: "Assistive Ergonomic Grip",
    description:
      "Custom-fit adaptive grip prototype using rapid iteration with flexible and rigid print materials.",
    imageUrl:
      "https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?auto=format&fit=crop&w=1200&q=80",
    tools: ["3D Printer", "Calipers", "Heat Gun"],
  },
  {
    id: "campus-wayfinder",
    title: "Campus Wayfinder Display",
    description:
      "Interactive wayfinding kiosk concept with engraved panels, touch controls, and modular enclosure.",
    imageUrl:
      "https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=1200&q=80",
    tools: ["Laser Cutter", "Drill Press", "Raspberry Pi"],
  },
  {
    id: "bike-safety-light",
    title: "Adaptive Bike Safety Light",
    description:
      "A weather-resistant bicycle light system that auto-adjusts brightness based on ambient conditions.",
    imageUrl:
      "https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1200&q=80",
    tools: ["Electronics Bench", "Soldering Station", "Oscilloscope"],
  },
  {
    id: "acoustic-panel-kit",
    title: "Acoustic Panel Kit",
    description:
      "Parametric wall panel kit for studios, designed for quick assembly and tuned sound diffusion.",
    imageUrl:
      "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=80",
    tools: ["CNC Router", "Table Saw", "Orbital Sander"],
  },
];
