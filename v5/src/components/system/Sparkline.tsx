import { cn } from "@/lib/utils";

/**
 * A word-sized graphic (Tufte): a trend drawn at the size of the text beside
 * it, no axes, no gridlines, no legend. The last value is marked in the accent
 * so the eye lands on "now"; the maximum is marked so the scale is legible
 * without an axis.
 *
 * `bars` is the default because the series we draw are daily **counts** — a
 * line between two days implies values in between that never existed.
 *
 * The graphic is `aria-hidden`; the caller supplies `label`, a sentence that
 * says what the picture says ("14 tickets in the last 30 days, 3 today").
 */
export interface SparklineProps {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
  variant?: "bars" | "line";
  className?: string;
}

export function Sparkline({ values, label, width = 96, height = 20, variant = "bars", className }: SparklineProps) {
  const max = Math.max(1, ...values);
  const count = values.length;
  const last = values[count - 1] ?? 0;
  const maxIndex = values.lastIndexOf(Math.max(...values));

  return (
    <span className={cn("inline-flex items-end", className)} role="img" aria-label={label}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
        {variant === "bars" ? (
          values.map((value, i) => {
            const step = width / count;
            const w = Math.max(1, step - 1);
            const h = value === 0 ? 1 : Math.max(2, (value / max) * height);
            const isLast = i === count - 1;
            return (
              <rect
                key={i}
                x={i * step}
                y={height - h}
                width={w}
                height={h}
                className={isLast ? "fill-primary-ink" : value === 0 ? "fill-foreground/15" : "fill-foreground/45"}
              />
            );
          })
        ) : (
          <>
            <polyline
              fill="none"
              strokeWidth={1}
              className="stroke-foreground/55"
              points={values.map((v, i) => `${(i / Math.max(1, count - 1)) * width},${height - (v / max) * (height - 2) - 1}`).join(" ")}
            />
            <circle
              cx={width}
              cy={height - (last / max) * (height - 2) - 1}
              r={1.75}
              className="fill-primary-ink"
            />
            {maxIndex >= 0 && maxIndex !== count - 1 ? (
              <circle
                cx={(maxIndex / Math.max(1, count - 1)) * width}
                cy={1}
                r={1.25}
                className="fill-foreground/70"
              />
            ) : null}
          </>
        )}
      </svg>
    </span>
  );
}
