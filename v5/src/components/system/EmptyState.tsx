import { cn } from "@/lib/utils";

/**
 * The one empty state (spec §7.2; DESIGN.md §8.9): a sentence that says **what
 * is missing and why**, then the next move. Never "No results" alone — the
 * caller passes the sentence that names the filter that emptied the list, or
 * the setup that is missing ("No tools match State: Archived." + Clear
 * filters). It replaces `td-empty`, `admin-empty`, `empty-state` and
 * `project-empty`.
 */
export interface EmptyStateProps {
  /** The sentence, translated. */
  children: React.ReactNode;
  /** The next action — usually one `Button` or link. */
  action?: React.ReactNode;
  /**
   * `bad` for an error branch — something could not be read — in the bad ink,
   * announced (`role="alert"`). Failing is said, never shown as an empty list
   * (Article 4).
   */
  tone?: "muted" | "bad";
  className?: string;
}

export function EmptyState({ children, action, tone = "muted", className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      data-tone={tone}
      role={tone === "bad" ? "alert" : undefined}
      className={cn(
        "ui flex flex-wrap items-center justify-between gap-3 border-y border-dashed border-border px-1 py-5 text-sm",
        tone === "bad" ? "text-bad" : "text-muted-foreground",
        className
      )}
    >
      <p className="max-w-[72ch]">{children}</p>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
