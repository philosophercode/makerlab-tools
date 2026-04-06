import Link from "next/link";

import type { GalleryCardProps } from "@/lib/types";

function FallbackImage() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-neutral-500">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-12 w-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3.25" y="4.25" width="17.5" height="15.5" rx="2.5" />
        <path d="M7 15.5l3-3 2.5 2.5 2-2 2.5 2.5" />
        <circle cx="9" cy="9" r="1.25" />
      </svg>
    </div>
  );
}

export default function GalleryCard({
  id,
  title,
  description,
  imageUrl,
  tools,
}: GalleryCardProps) {
  return (
    <Link
      href={`/gallery/${id}`}
      className="group block overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-neutral-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <FallbackImage />
        )}
      </div>

      <div className="space-y-3 p-4">
        <div>
          <h3 className="truncate text-base font-semibold text-neutral-900">{title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{description}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {tools.map((tool) => (
            <span
              key={tool}
              className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700"
            >
              {tool}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
