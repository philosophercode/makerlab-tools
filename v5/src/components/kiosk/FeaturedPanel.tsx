"use client";

import { useTranslations } from "next-intl";
import type { KioskFeatured } from "@/lib/kiosk/types";
import { cn } from "@/lib/utils";
import { ToolImage } from "../ToolImage";
import { KIOSK_TYPE } from "./kiosk-type";

/**
 * One featured tool or published student project at a time (kiosk spec §6),
 * rotating every 20 s in the day's order. The item fades in; with
 * `prefers-reduced-motion` it cuts (§6 "Motion"). Nothing to feature draws
 * nothing — the panel is decoration, not status.
 */
export function FeaturedPanel({ item, className }: { item: KioskFeatured | null; className?: string }) {
  const t = useTranslations("kiosk");
  if (!item) return null;

  const name = item.kind === "tool" ? item.name : item.title;
  const image = item.kind === "tool" ? item.imageSrc : item.coverSrc;

  return (
    <section aria-labelledby="kiosk-featured" className={cn("flex min-w-0 flex-col gap-[1.5vmin]", className)}>
      <h2 id="kiosk-featured" className={KIOSK_TYPE.label}>
        {t("featuredHeading")} · {item.kind === "tool" ? t("featuredTool") : t("featuredProject")}
      </h2>
      <article
        key={`${item.kind}:${item.slug}`}
        data-kiosk-featured={item.slug}
        className="flex min-w-0 items-start gap-[max(12px,2vmin)] border border-border bg-card p-[max(10px,1.5vmin)] animate-in fade-in duration-1000 motion-reduce:animate-none"
      >
        <ToolImage src={image} name={name} sizes="20vmin" className="size-(--kiosk-featured-thumb) shrink-0" />
        <div className="flex min-w-0 flex-col gap-[1vmin]">
          <p className={cn(KIOSK_TYPE.body, "line-clamp-2 font-medium")}>{name}</p>
          {item.kind === "tool" ? (
            <p className={cn(KIOSK_TYPE.small, "line-clamp-3 text-muted-foreground kiosk-wall:line-clamp-2 kiosk-phone:line-clamp-4")}>{item.shortDescription}</p>
          ) : (
            <>
              {item.author ? <p className={KIOSK_TYPE.small}>{t("featuredBy", { name: item.author })}</p> : null}
              {item.toolNames.length > 0 ? (
                <p className={cn(KIOSK_TYPE.small, "line-clamp-2 text-muted-foreground")}>
                  {t("builtWith", { tools: item.toolNames.join(", ") })}
                </p>
              ) : null}
            </>
          )}
        </div>
      </article>
    </section>
  );
}
