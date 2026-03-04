import Image from "next/image";
import type { ToolWithMeta } from "@/lib/types";
import ToolCard from "./ToolCard";

export type ViewMode = "compact" | "grid" | "table";

const GRID_CLASSES: Record<Exclude<ViewMode, "table">, string> = {
  compact: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  grid: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
};

export default function ToolGrid({
  tools,
  viewMode = "compact",
  showGenerated = true,
}: {
  tools: ToolWithMeta[];
  viewMode?: ViewMode;
  showGenerated?: boolean;
}) {
  if (tools.length === 0) {
    return (
      <div className="py-20 text-center text-muted">
        <p className="text-lg">No tools found</p>
        <p className="mt-1 text-sm">Try adjusting your search or filters.</p>
      </div>
    );
  }

  if (viewMode === "table") {
    return <TableView tools={tools} showGenerated={showGenerated} />;
  }

  return (
    <div className={GRID_CLASSES[viewMode]}>
      {tools.map((tool, i) => (
        <ToolCard key={tool.id} tool={tool} compact={viewMode === "compact"} priority={i < 8} showGenerated={showGenerated} />
      ))}
    </div>
  );
}

function TableView({ tools, showGenerated }: { tools: ToolWithMeta[]; showGenerated: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-card-border">
      {/* Header — hidden on mobile */}
      <div className="hidden sm:grid sm:grid-cols-[44px_1fr_1fr_1fr_auto] gap-3 px-4 py-2 bg-muted-bg text-xs font-medium text-muted border-b border-card-border">
        <span />
        <span>Name</span>
        <span>Category</span>
        <span>Location</span>
        <span className="w-24 text-right">Safety</span>
      </div>

      {tools.map((tool, i) => {
        const hasPPE = tool.ppe_required.length > 0;
        const needsAuth = tool.authorized_only;
        const needsTraining = tool.training_required;
        const hasSafety = hasPPE || needsAuth || needsTraining;

        return (
          <a
            key={tool.id}
            href={`/tools/${tool.id}`}
            className={`group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted-bg/60 ${
              i % 2 === 0 ? "bg-card-bg" : "bg-muted-bg/30"
            } ${i < tools.length - 1 ? "border-b border-card-border/50" : ""}`}
          >
            {/* Thumbnail */}
            <div className="relative h-10 w-10 flex-shrink-0 rounded-md bg-muted-bg overflow-hidden">
              {(tool.image_url || tool.generated_image_url) ? (
                <Image
                  src={(showGenerated && tool.generated_image_url) || tool.image_url!}
                  alt={tool.name}
                  fill
                  className="object-contain p-0.5"
                  sizes="40px"
                  priority={i < 4}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted text-[10px]">
                  —
                </div>
              )}
            </div>

            {/* Name — always visible */}
            <span className="min-w-0 flex-1 text-sm font-medium leading-tight truncate group-hover:text-primary transition-colors">
              {tool.name}
            </span>

            {/* Category — hidden on mobile */}
            <span className="hidden sm:block flex-1 text-xs text-muted truncate">
              {tool.category_group}
            </span>

            {/* Location — hidden on mobile */}
            <span className="hidden sm:block flex-1 text-xs text-muted truncate">
              {tool.location_room}
            </span>

            {/* Safety badges */}
            <div className="flex flex-shrink-0 gap-1 sm:w-24 sm:justify-end">
              {hasSafety ? (
                <>
                  {hasPPE && (
                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning font-medium">
                      PPE
                    </span>
                  )}
                  {needsTraining && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-medium">
                      Train
                    </span>
                  )}
                  {needsAuth && (
                    <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger font-medium">
                      Auth
                    </span>
                  )}
                </>
              ) : (
                <span className="hidden sm:inline text-[10px] text-muted/40">
                  —
                </span>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}
