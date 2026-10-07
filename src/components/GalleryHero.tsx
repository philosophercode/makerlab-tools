import type { ReactNode } from "react";

/**
 * The gallery's display header (DESIGN.md §4: display type on the gallery and
 * tool hero only): the title in Space Grotesk — simply "Tools" since the
 * identity spec (2026-09-28 §2), in its own case, with no `+` glyph — then a
 * mono facts line, then the on-shift line when the page passes one. Shared
 * by the gallery and its loading fallback so the page does not jump when the
 * catalogue arrives.
 */
export function GalleryHero({ title, facts, aside = null }: { title: string; facts?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 pt-8 pb-5 sm:pt-10">
      <h1 id="gallery-title" className="font-heading text-[clamp(42px,7vw,88px)] leading-[0.92] font-medium tracking-tight normal-case">
        {title}
      </h1>
      {facts ? <p className="font-mono text-label text-muted-foreground uppercase tabular-nums">{facts}</p> : null}
      {/* Who is on shift, when somebody is (on-shift spec 2026-10-07): a line of its own, or nothing. */}
      {aside}
    </header>
  );
}
