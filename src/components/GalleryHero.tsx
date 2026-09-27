import type { ReactNode } from "react";

/**
 * The gallery's display header (DESIGN.md §4: display type on the gallery and
 * tool hero only): the `+` target glyph in the accent ink and the title in
 * Space Grotesk, then a mono facts line. Shared by the gallery and its
 * loading fallback so the page does not jump when the catalogue arrives.
 */
export function GalleryHero({ title, facts }: { title: string; facts?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2 pt-8 pb-5 sm:pt-10">
      <div className="flex items-start gap-3 sm:gap-5">
        <span aria-hidden="true" className="pt-[0.1em] font-heading text-3xl text-primary-ink sm:text-5xl">
          +
        </span>
        <h1 id="gallery-title" className="font-heading text-[clamp(42px,7vw,88px)] leading-[0.92] font-medium tracking-tight uppercase">
          {title}
        </h1>
      </div>
      {facts ? (
        <p className="font-mono text-label text-muted-foreground uppercase tabular-nums sm:ps-[3.25rem]">{facts}</p>
      ) : null}
    </header>
  );
}
