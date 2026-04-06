import Link from "next/link";

import GalleryCard from "@/components/GalleryCard";
import { mockProjects } from "@/lib/mockGalleryData";

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
