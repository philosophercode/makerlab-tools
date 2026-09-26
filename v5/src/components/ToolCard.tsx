import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MakerLabTool, ToolStatus } from "./catalog-types";
import { StatusGlyph, type StatusTone } from "./system/StatusGlyph";
import { ToolImage } from "./ToolImage";

interface ToolCardProps {
  tool: MakerLabTool;
  /** h2 on an ungrouped gallery; h3 under a group's h2. */
  headingLevel?: 2 | 3;
}

/** A tool's status as a glyph tone — never colour alone, never a pulsing dot. */
export const TOOL_STATUS_TONE: Record<ToolStatus, StatusTone> = {
  Available: "ok",
  "In Use": "idle",
  "Training Required": "warn",
  Offline: "bad",
};

export const TOOL_STATUS_KEY: Record<ToolStatus, "available" | "inUse" | "trainingRequired" | "offline"> = {
  Available: "available",
  "In Use": "inUse",
  "Training Required": "trainingRequired",
  Offline: "offline",
};

/**
 * One tool in the gallery grid (UI system phase 5a): the product image on its
 * plate, the name, and one mono line — status as glyph + word, then the
 * category. The whole card is the link. Replaces the legacy `tool-card` rules
 * and the pulsing orange `card-status-dot`, which said "in use" by colour alone.
 */
export function ToolCard({ tool, headingLevel = 2 }: ToolCardProps) {
  const t = useTranslations("gallery");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <Link
      href={`/tools/${tool.slug}`}
      data-slot="tool-card"
      className="group flex h-full flex-col border border-border bg-card transition-colors duration-150 hover:border-primary-ink/60"
    >
      <ToolImage
        src={tool.imageSrc}
        name={tool.name}
        sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
        className="aspect-[4/3] w-full p-4"
      />
      <span className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <Heading className="font-heading text-[15px] leading-tight font-medium uppercase group-hover:text-primary-ink">
          {tool.name}
        </Heading>
        <span className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-label text-muted-foreground uppercase">
          <StatusGlyph tone={TOOL_STATUS_TONE[tool.status]} label={t(`status.${TOOL_STATUS_KEY[tool.status]}`)} />
          <span aria-hidden="true">·</span>
          <span>{tool.category}</span>
        </span>
      </span>
    </Link>
  );
}
