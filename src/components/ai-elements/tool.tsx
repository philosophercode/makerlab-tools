"use client";

/**
 * AI Elements `Tool` / `ToolHeader`, copied from registry.ai-sdk.dev/tool.json
 * (UI system spec §9.1; phase 5b) and cut to the header: in this chat a tool
 * call is **a one-line status** — "📖 Searching the Form 4 manual…" with a
 * spinner while it runs — never its JSON. Upstream's `ToolContent` /
 * `ToolInput` / `ToolOutput` (a collapsible holding a Shiki `code-block`) are
 * left out, and with them the collapsible trigger that would expand nothing.
 *
 * Local edits: the state is a mark, not a pill — a `Loader` while the call
 * runs, ■ in the bad ink when it failed, ● when it finished — and the words
 * are the caller's translated `title` alone (upstream adds a hard-coded
 * English "Running" / "Completed" badge). The caller names the group ("Tool
 * running") so the log reads the line as one thing.
 */

import type { ToolUIPart } from "ai";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Loader } from "./loader";

export type ToolProps = ComponentProps<"div">;

export const Tool = ({ className, ...props }: ToolProps) => (
  <div data-slot="tool" role="group" className={cn("w-full", className)} {...props} />
);

export type ToolHeaderProps = {
  /** What the call is doing, in words ("Searching the manual…"). */
  title: string;
  state: ToolUIPart["state"];
  className?: string;
};

const RUNNING = new Set<ToolUIPart["state"]>(["input-streaming", "input-available"]);

export const ToolHeader = ({ className, title, state }: ToolHeaderProps) => {
  const running = RUNNING.has(state);
  const failed = state === "output-error" || state === "output-denied";
  return (
    <p
      data-slot="tool-header"
      data-state={state}
      className={cn("flex items-center gap-2 font-mono text-label tracking-[0.04em] text-muted-foreground", className)}
    >
      {running ? (
        <Loader size={12} className="text-primary-ink" />
      ) : (
        <span aria-hidden="true" className={cn("inline-block w-3 text-center", failed ? "text-bad" : "text-ok")}>
          {failed ? "■" : "●"}
        </span>
      )}
      <span className="min-w-0">{title}</span>
    </p>
  );
};
