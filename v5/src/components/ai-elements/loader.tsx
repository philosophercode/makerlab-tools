import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/**
 * AI Elements `Loader`, copied from registry.ai-sdk.dev/loader.json (UI system
 * phase 5b): the twelve-spoke spinner, in `currentColor`. Local edits: the
 * SVG is decorative (`aria-hidden`, no English `<title>`) — the caller names
 * what is loading, in words, on the wrapper or beside it — the unused clip
 * path is gone (its fixed id repeated on every spinner in the log), and it
 * stops turning under `prefers-reduced-motion`.
 */

type LoaderIconProps = {
  size?: number;
};

const SPOKES: Array<[string, number]> = [
  ["M8 0V4", 1],
  ["M8 16V12", 0.5],
  ["M3.29773 1.52783L5.64887 4.7639", 0.9],
  ["M12.7023 1.52783L10.3511 4.7639", 0.1],
  ["M12.7023 14.472L10.3511 11.236", 0.4],
  ["M3.29773 14.472L5.64887 11.236", 0.6],
  ["M15.6085 5.52783L11.8043 6.7639", 0.2],
  ["M0.391602 10.472L4.19583 9.23598", 0.7],
  ["M15.6085 10.4722L11.8043 9.2361", 0.3],
  ["M0.391602 5.52783L4.19583 6.7639", 0.8],
];

const LoaderIcon = ({ size = 16 }: LoaderIconProps) => (
  <svg aria-hidden="true" focusable="false" height={size} strokeLinejoin="round" viewBox="0 0 16 16" width={size}>
    {SPOKES.map(([d, opacity]) => (
      <path key={d} d={d} opacity={opacity} stroke="currentColor" strokeWidth="1.5" />
    ))}
  </svg>
);

export type LoaderProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

export const Loader = ({ className, size = 16, ...props }: LoaderProps) => (
  <span
    data-slot="loader"
    className={cn("inline-flex animate-spin items-center justify-center motion-reduce:animate-none", className)}
    {...props}
  >
    <LoaderIcon size={size} />
  </span>
);
