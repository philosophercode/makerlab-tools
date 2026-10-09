"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FoundPhotoView } from "../../../lib/intake/types";
import { cn } from "@/lib/utils";

/**
 * The photo looked up for an item named without one (data platform spec
 * amendment "A photo for a name"), as a thumbnail that says what it is: a
 * picture **found online and not confirmed** — a dashed frame and a "Found
 * online" tag, the host in its tooltip — never mistaken for a photo somebody
 * took. Shared by the chat's intake card and `/admin/intake`.
 *
 * - `searching` — a frame saying "Finding a photo…", or nothing when `quiet`.
 * - `found` — the picture: our route for the private background-removed copy,
 *   else its own URL on its own host, loaded sending no referrer. A host that
 *   refuses it falls back to nothing (or "No photo").
 * - `none`, `failed` — nothing, or "No photo" when `emptyLabel` is on.
 */
export function FoundPhotoThumb({
  photo,
  name,
  className,
  quiet = false,
  emptyLabel = false,
}: {
  photo: FoundPhotoView;
  name: string;
  /** The frame's size, e.g. `size-12`. */
  className?: string;
  /** Show nothing while searching (the intake list shows no placeholder). */
  quiet?: boolean;
  /** Show "No photo" when there is none, as the card does for every row. */
  emptyLabel?: boolean;
}) {
  const t = useTranslations("intake.table");
  const [broken, setBroken] = useState(false);
  const frame = cn(
    "flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted p-0.5 text-center text-[9px] leading-tight break-all text-muted-foreground",
    className
  );

  if (photo.status === "searching") {
    return quiet ? null : (
      <span className={frame} role="status">
        {t("foundPhotoSearching")}
      </span>
    );
  }
  if (photo.status !== "found" || !photo.src || broken) {
    return emptyLabel ? <span className={frame}>{t("noPhoto")}</span> : null;
  }

  const title = photo.host ? t("foundPhotoTitle", { host: photo.host }) : t("foundPhotoTitleNoHost");
  return (
    <span className={cn("relative flex shrink-0 overflow-hidden border border-dashed border-muted-foreground bg-card", className)} title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our private route or an arbitrary host the search found; nothing for the optimizer, and the host is never proxied */}
      <img
        src={photo.src}
        alt={t("foundPhotoAlt", { name })}
        className="size-full object-contain"
        loading="lazy"
        referrerPolicy={photo.external ? "no-referrer" : undefined}
        onError={() => setBroken(true)}
      />
      <span className="absolute inset-x-0 bottom-0 bg-background/85 text-center font-mono text-[8px] leading-tight uppercase text-foreground">
        {t("foundPhotoTag")}
      </span>
    </span>
  );
}
