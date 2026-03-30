import Link from "next/link";
import GalleryCard, { type GalleryCardProps } from "@/components/GalleryCard";

const mockProjects: GalleryCardProps[] = [
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

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Student Gallery</h1>
          <p className="mt-1 text-sm text-muted">Explore student-built projects from the MakerLab.</p>
        </div>

        <Link
          href="/gallery/submit"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Submit a project"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      </div>

      {mockProjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
          <p className="text-base font-medium text-neutral-700">No projects yet</p>
          <p className="mt-1 text-sm text-neutral-500">Check back soon for new student work.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {mockProjects.map((project) => (
            <GalleryCard key={project.id} {...project} />
          ))}
        </div>
      )}
    </div>
  );
}
