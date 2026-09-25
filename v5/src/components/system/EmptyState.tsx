import { cn } from "@/lib/utils";

/**
 * The one empty state (UI system spec §6.9): says **what is missing and why**,
 * then offers the next move. Never "No results" on its own — the caller passes
 * the sentence that names the filter or the missing setup.
 */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ui flex flex-wrap items-center justify-between gap-3 border-y border-dashed border-border px-1 py-5 text-[14px] text-muted-foreground", className)}>
      <p className="max-w-[72ch]">{children}</p>
      {action}
    </div>
  );
}
