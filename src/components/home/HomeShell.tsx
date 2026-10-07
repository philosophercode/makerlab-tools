"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { HomeSearch } from "./HomeSearch";
import { CategoryTileCard } from "./CategoryTileCard";
import { categoryTiles, galleryToolCount, type HomeTool } from "./home-tools";
import { ALL_TOOLS_PATH } from "../../lib/gallery-links";

/**
 * The student home (student home spec 2026-10-07; design review option B,
 * the calmer gallery, with the owner's addendum): the smart search box on
 * its own, then **Tools**, the categories as large tiles; then the way to the
 * full list. Nothing else: no "Start here" band, no filters (they are the
 * full list's), and no big wordmark — the logo appears once, in the header
 * (amendment "The logo once").
 */
export function HomeShell({
  tools,
  categoryOrder,
}: {
  tools: readonly HomeTool[];
  categoryOrder: readonly string[];
}) {
  const t = useTranslations("gallery.home");
  const tGallery = useTranslations("gallery");
  const tiles = useMemo(() => categoryTiles(tools, categoryOrder), [tools, categoryOrder]);
  const count = useMemo(() => galleryToolCount(tools), [tools]);

  return (
    <main className="ui mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8" data-slot="home">
      <section
        aria-label={t("searchSection")}
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 pt-8 pb-10 sm:pt-14 sm:pb-14 lg:pt-16"
      >
        <HomeSearch tools={tools} toolCount={count} />
      </section>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-rule pb-3">
        <h1 id="home-title" className="font-heading text-[clamp(36px,5vw,64px)] leading-[0.92] font-medium tracking-tight normal-case">
          {tGallery("title")}
        </h1>
        <SeeAll count={count} />
      </div>

      {tiles.length > 0 ? (
        <ul aria-labelledby="home-title" className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4" data-slot="category-tiles">
          {tiles.map((tile, index) => (
            <li key={tile.name} className="min-w-0">
              <CategoryTileCard tile={tile} imagePriority={index < 2 ? "high" : index < 4 ? "eager" : "lazy"} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
      )}

      <div className="mt-8 flex justify-center">
        <Link
          href={ALL_TOOLS_PATH}
          data-slot="see-all-button"
          className="inline-flex h-11 items-center gap-2 border border-foreground px-5 font-mono text-label tracking-[0.08em] uppercase transition-colors duration-150 hover:bg-foreground hover:text-background"
        >
          {t("seeAll", { count })}
          <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Link>
      </div>
    </main>
  );
}

function SeeAll({ count }: { count: number }) {
  const t = useTranslations("gallery.home");
  return (
    <Link
      href={ALL_TOOLS_PATH}
      data-slot="see-all-link"
      className="inline-flex items-center gap-1.5 pb-1 font-mono text-label tracking-[0.08em] text-primary-ink uppercase underline underline-offset-4 hover:no-underline"
    >
      {t("seeAll", { count })}
      <ArrowRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />
    </Link>
  );
}
