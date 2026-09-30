import { cn } from "@/lib/utils";
import { shotSources, shotSrc, type Shot } from "../../app/product/product-content";

/**
 * One screenshot on the product pages (identity spec amendment 2026-09-28
 * "Product page and quick start"): a `<picture>` with AVIF and WebP at two
 * widths, the intrinsic size for the aspect ratio (no layout shift), lazy
 * unless it is the first screen, and a caption saying where it came from —
 * the live site or the demo seed. A hairline frame and nothing else (square,
 * flat, no shadow: UI system §3.10).
 */
export function ProductShot({
  shot,
  alt,
  caption,
  sizes,
  priority = false,
  className,
}: {
  shot: Shot;
  alt: string;
  /** The source line under the image ("Demo data", "Live site, …"). */
  caption?: string;
  sizes: string;
  /** The first screen's image: eager, high fetch priority. */
  priority?: boolean;
  className?: string;
}) {
  return (
    <figure data-slot="product-shot" className={cn("m-0 flex min-w-0 flex-col gap-1.5", className)}>
      <picture className="block border border-border bg-card">
        <source type="image/avif" srcSet={shotSources(shot, "avif")} sizes={sizes} />
        <source type="image/webp" srcSet={shotSources(shot, "webp")} sizes={sizes} />
        {/* Pre-rendered AVIF/WebP widths: a plain img, as ToolImage does; next/image would re-encode them. */}
        <img
          src={shotSrc(shot)}
          alt={alt}
          width={shot.width}
          height={shot.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          className="block h-auto w-full"
        />
      </picture>
      {caption ? <figcaption className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{caption}</figcaption> : null}
    </figure>
  );
}
