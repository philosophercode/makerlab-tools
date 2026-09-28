"use client";

import Image from "next/image";
import { useState } from "react";
import { thumbnailFallbackSrc, thumbnailSrcSet, type ImageThumbnails } from "@/lib/images/thumbnail-urls";
import { cn } from "@/lib/utils";

/**
 * How urgently the image is fetched. `"high"` is the page's likely LCP image
 * (the tool page's hero, the first gallery cards): eager and
 * `fetchpriority="high"`. `"eager"` is above the fold on some screen but not
 * the LCP. Anything else is lazy.
 */
export type ToolImagePriority = "high" | "eager" | "lazy";

/**
 * A tool's product image, contained on its plate — or, when the file is
 * missing (a tool with no photo yet and no bundled one), the empty plate with
 * the tool's initials in mono instead of the browser's broken-image icon
 * (UI system phase 5a: an empty state is shown honestly, never as breakage).
 * Decorative: the tool's name is always beside it.
 *
 * **Served at the size it is shown.** With `thumbnails` (every bundled photo,
 * and a Blob photo once its thumbnails are written) it is a `<picture>` of the
 * pre-rendered AVIF and WebP widths, and `sizes` lets the browser take the
 * smallest that fills the plate — a few KB instead of a 2 MB PNG. Without
 * them it falls back to `next/image`, which resizes the original on demand.
 * Either way the image is `contain`ed exactly as before: a thumbnail is the
 * same picture with fewer pixels, so it keeps its visual weight.
 */
export function ToolImage({
  src,
  thumbnails,
  name,
  sizes,
  className,
  priority = "lazy",
}: {
  src: string;
  thumbnails?: ImageThumbnails | null;
  name: string;
  sizes: string;
  className?: string;
  priority?: ToolImagePriority;
}) {
  const [failed, setFailed] = useState(false);
  const loading = priority === "lazy" ? "lazy" : "eager";
  const fetchPriority = priority === "high" ? "high" : undefined;
  return (
    <span aria-hidden="true" className={cn("relative block overflow-hidden bg-muted", className)}>
      {failed || (!src && !thumbnails) ? (
        <span data-slot="tool-image-empty" className="flex h-full w-full items-center justify-center font-mono text-label text-muted-foreground uppercase">
          {initials(name)}
        </span>
      ) : thumbnails ? (
        <picture data-slot="tool-image-thumbnails">
          <source type="image/avif" srcSet={thumbnailSrcSet(thumbnails, "avif")} sizes={sizes} />
          <source type="image/webp" srcSet={thumbnailSrcSet(thumbnails, "webp")} sizes={sizes} />
          <img
            src={thumbnailFallbackSrc(thumbnails)}
            alt=""
            width={thumbnails.width}
            height={thumbnails.height}
            loading={loading}
            fetchPriority={fetchPriority}
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        </picture>
      ) : (
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          style={{ objectFit: "contain" }}
          loading={loading}
          fetchPriority={fetchPriority}
          // The local Blob store's files (`/api/dev-blob/…`) are served by
          // this app itself, which the optimizer only fetches in `next dev`.
          unoptimized={src.includes("/api/dev-blob/")}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}
