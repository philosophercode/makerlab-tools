"use client";

/**
 * The running-tool line (UI system spec §8.1): what AI Elements' `Tool`
 * header shows while a tool call is in flight — a spinner and a sentence —
 * without the collapsible input/output body, which the lab's visitors do not
 * need to see. When the chat phase adopts `Tool` itself (for the admin
 * curation turns, where the input is worth showing), this becomes its
 * collapsed state.
 */

import { cn } from "@/lib/utils";
import { Loader } from "./loader";

export function ToolStatus({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center gap-2 font-mono text-[12px] text-muted-foreground", className)}
    >
      <Loader size={12} />
      <span>{children}</span>
    </div>
  );
}
