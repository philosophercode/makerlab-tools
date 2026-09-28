"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AdminActionWarning } from "../../lib/admin/action-result";
import { cn } from "@/lib/utils";

/**
 * The one line every admin row control speaks through (spec §6, §4.11;
 * DESIGN.md §8.9) — the inline outcome of an action, never a toast (owner
 * decision 2026-09-25).
 *
 * Two forms, one look:
 *
 * - **Codes** (`pending` / `saved` / `error` / `warning`): what `RoleSelect`
 *   and the queues' `useRowAction` report. The *order* of these branches is
 *   the contract — a warning and an error are never shown together, and
 *   "Saved" never appears beside a reason the save did not happen. It renders
 *   codes, not sentences: `admin.errors.<code>` and `admin.warnings.<code>` are
 *   the shared families, so a code added to the gate is translated everywhere
 *   at once (Article 6).
 * - **A message** (`tone` + children): an outcome the caller has already
 *   worded — an upload that failed, an import the parser refused, a refresh
 *   that could not start.
 *
 * Always in the DOM, `role="status"` by default (`"alert"` for a refusal the
 * person must see now), so a screen reader hears each outcome where it heard
 * the last; empty, it takes no space. Warn is the status warn ink — a change
 * that landed minus a guarantee, not a failure — and bad is the status bad ink.
 */

export type RowStatusTone = "muted" | "ok" | "warn" | "bad";

interface Common {
  role?: "status" | "alert";
  className?: string;
  /** The element: a `span` (default, valid anywhere), or a `p` in running text. */
  as?: "p" | "span";
}

export interface RowStatusCodeProps extends Common {
  pending: boolean;
  /** True once a change has landed and nothing has qualified it. */
  saved: boolean;
  /** An `admin.errors.<code>` key, or null. */
  error: string | null;
  /** An `admin.warnings.<code>` key, or null. */
  warning: AdminActionWarning | null;
}

export interface RowStatusMessageProps extends Common {
  tone: RowStatusTone;
  children?: ReactNode;
}

export type RowStatusProps = RowStatusCodeProps | RowStatusMessageProps;

const INK: Record<RowStatusTone, string> = {
  muted: "text-muted-foreground",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

export function RowStatus(props: RowStatusProps) {
  if ("tone" in props) {
    return (
      <StatusLine tone={props.tone} role={props.role} className={props.className} as={props.as}>
        {props.children}
      </StatusLine>
    );
  }
  return <CodedStatus {...props} />;
}

function CodedStatus({ pending, saved, error, warning, role, className, as }: RowStatusCodeProps) {
  const t = useTranslations("admin");
  const tone: RowStatusTone = error ? "bad" : warning ? "warn" : "muted";
  return (
    <StatusLine tone={tone} role={role} className={className} as={as}>
      {pending ? t("saving") : null}
      {!pending && saved && !error && !warning ? t("saved") : null}
      {!pending && warning ? t(`warnings.${warning}`) : null}
      {!pending && error ? t(`errors.${error}`) : null}
    </StatusLine>
  );
}

function StatusLine({
  tone,
  role = "status",
  className,
  as: Element = "span",
  children,
}: Common & { tone: RowStatusTone; children?: ReactNode }) {
  return (
    <Element
      role={role}
      data-slot="row-status"
      data-tone={tone}
      className={cn("ui m-0 block basis-full text-xs leading-snug empty:hidden", INK[tone], className)}
    >
      {children}
    </Element>
  );
}

/**
 * The short half of a save-on-click control's outcome — "Saving…", then
 * "Saved" — in a **reserved inline slot** beside the controls (public
 * polish): the slot has its width from the first paint, so nothing in the row
 * moves when the word appears. A refusal or a warning is a sentence, not a
 * word; the caller shows it on its own line with `RowStatus` (codes, with
 * `pending` and `saved` false), where it has room to be read.
 */
export function SaveSlot({ pending, saved, error, warning, className }: RowStatusCodeProps) {
  const t = useTranslations("admin");
  const word = pending ? t("saving") : saved && !error && !warning ? t("saved") : null;
  return (
    <span
      role="status"
      data-slot="save-slot"
      className={cn("ui inline-block w-16 shrink-0 font-mono text-micro tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase", className)}
    >
      {word}
    </span>
  );
}

