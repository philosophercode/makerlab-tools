import type { ReactNode } from "react";

/**
 * One setting on a Settings page (admin sections spec 2026-10-07): a mono
 * heading, a sentence or two saying what it is for, and its control under
 * them. A bordered plate, like the overview's side blocks, so a page of a few
 * settings reads as a short list rather than a form.
 */
export function SettingsBlock({ id, title, body, children }: { id: string; title: string; body: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2 border border-border bg-card p-4">
      <h3 id={`${id}-heading`} className="m-0 font-mono text-label font-medium tracking-[0.08em] uppercase">
        {title}
      </h3>
      <div className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">{body}</div>
      {children ? <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div> : null}
    </section>
  );
}
