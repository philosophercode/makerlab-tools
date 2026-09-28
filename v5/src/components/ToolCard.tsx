import Link from "next/link";
import type { MakerLabTool, ToolStatus } from "./catalog-types";
import type { StatusTone } from "./system/StatusGlyph";
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
 * One tool in the gallery grid: the product image on its plate, the display
 * name and the category — nothing else (owner, public polish). Availability
 * and training are the tool page's and the table view's (a column and a
 * facet); on a card they were tags that made every card read the same. The
 * whole card is the link.
 */
export function ToolCard({ tool, headingLevel = 2 }: ToolCardProps) {
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
        <span className="mt-auto font-mono text-label text-muted-foreground uppercase">{tool.category}</span>
      </span>
    </Link>
  );
}
