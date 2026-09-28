"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import { RowStatus } from "../admin/RowStatus";

/**
 * A one-shot action whose state lives **inside the button** (DESIGN.md
 * §8.10; owner, 2026-09-25): Refresh catalog, Looks good, Re-process.
 *
 * - **idle** — the label.
 * - **pending** — a small spinner over the label, which stays in place
 *   (invisible) so the button keeps its width; disabled and `aria-busy`.
 * - **done** — a check and `doneLabel` for {@link DONE_MS}, then idle again.
 *   Both labels share one grid cell, so the width never shifts between them.
 * - **error** — back to the label, with the reason on the `RowStatus` line
 *   beside it (no toasts, owner decision 2026-09-25).
 *
 * `onRun` answers what happened: `true` for done, a translated sentence for an
 * error to show here, or `false` for a failure the caller reports elsewhere
 * (the tool editor's status line) — the button then just returns to idle.
 * A screen reader hears the outcome through the same live region: `doneMessage`
 * (or `doneLabel`) on success, the sentence on failure.
 */

/** How long "Done" shows before the label returns. */
export const DONE_MS = 1500;

export type AsyncButtonOutcome = true | false | string;

export interface AsyncButtonProps extends Omit<ButtonProps, "onClick" | "children" | "asChild"> {
  children: ReactNode;
  onRun: () => Promise<AsyncButtonOutcome>;
  /** The flash after success ("Done"). */
  doneLabel: string;
  /** What a screen reader hears on success, when more than `doneLabel` is useful ("Catalog refreshed"). */
  doneMessage?: string;
  /** Classes for the wrapper (the button and its status line). */
  wrapperClassName?: string;
}

type State = { kind: "idle" } | { kind: "pending" } | { kind: "done" } | { kind: "error"; message: string };

export function AsyncButton({
  children,
  onRun,
  doneLabel,
  doneMessage,
  wrapperClassName,
  className,
  disabled,
  ...buttonProps
}: AsyncButtonProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function run() {
    if (state.kind === "pending") return;
    if (timer.current) clearTimeout(timer.current);
    setState({ kind: "pending" });
    let outcome: AsyncButtonOutcome;
    try {
      outcome = await onRun();
    } catch {
      outcome = false;
    }
    if (outcome === true) {
      setState({ kind: "done" });
      timer.current = setTimeout(() => setState({ kind: "idle" }), DONE_MS);
    } else if (typeof outcome === "string") {
      setState({ kind: "error", message: outcome });
    } else {
      setState({ kind: "idle" });
    }
  }

  const pending = state.kind === "pending";
  const done = state.kind === "done";

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", wrapperClassName)}>
      <Button
        {...buttonProps}
        className={cn("relative", className)}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        data-state={state.kind}
        onClick={() => void run()}
      >
        {/* One cell, both labels: the wider sets the width, so nothing moves. */}
        <span className="inline-grid [grid-template-areas:'stack'] *:[grid-area:stack]">
          <span aria-hidden={done || undefined} className={cn(done || pending ? "invisible" : undefined)}>{children}</span>
          <span aria-hidden={!done || undefined} className={cn("inline-flex items-center justify-center gap-1", !done && "invisible")}>
            <Check aria-hidden="true" />
            {doneLabel}
          </span>
        </span>
        {pending ? (
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          </span>
        ) : null}
      </Button>
      {state.kind === "error" ? (
        <RowStatus tone="bad" role="alert" className="basis-auto">
          {state.message}
        </RowStatus>
      ) : (
        <RowStatus tone="muted" className="sr-only">
          {done ? (doneMessage ?? doneLabel) : null}
        </RowStatus>
      )}
    </span>
  );
}
