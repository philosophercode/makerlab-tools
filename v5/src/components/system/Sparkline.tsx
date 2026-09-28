import { cn } from "@/lib/utils";

/**
 * A word-sized graphic (Tufte; spec §3 rule 6; DESIGN.md §2.6): a trend drawn
 * at the size of the text beside it — no axes, gridlines or legend. The last
 * value is drawn in the accent ink so the eye lands on "now".
 *
 * `bars` is the default because the series we draw are daily **counts**; a
 * line between two days implies values in between that never existed. `line`
 * is for a continuous measure, and marks its maximum so the scale is legible
 * without an axis.
 *
 * The drawing is `aria-hidden`; the element is one `role="img"` named by
 * `label`, a translated sentence that says what the picture shows ("14 tickets
 * in the last 30 days, 3 today"). An empty series draws nothing but keeps the
 * sentence.
 */
export interface SparklineProps {
  values: readonly number[];
  /** What the picture says, in words (translated). */
  label: string;
  width?: number;
  height?: number;
  variant?: "bars" | "line";
  className?: string;
}

export function Sparkline({ values, label, width = 120, height = 18, variant = "bars", className }: SparklineProps) {
  const count = values.length;
  const peak = count ? Math.max(...values) : 0;
  const max = Math.max(1, peak);

  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-end", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
        className="overflow-visible"
      >
        {count === 0 ? null : variant === "bars" ? (
          <Bars values={values} max={max} width={width} height={height} />
        ) : (
          <Line values={values} max={max} peak={peak} width={width} height={height} />
        )}
      </svg>
    </span>
  );
}

interface Geometry {
  values: readonly number[];
  max: number;
  width: number;
  height: number;
}

function Bars({ values, max, width, height }: Geometry) {
  const step = width / values.length;
  const barWidth = Math.max(1, step - 1);
  return (
    <>
      {values.map((value, i) => {
        // A zero is drawn as a 1px stub, so "nothing that day" is visible and
        // distinct from "no data" (an empty series draws nothing at all).
        const h = value <= 0 ? 2 : Math.max(4, (value / max) * height);
        const isLast = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * step}
            y={height - h}
            width={barWidth}
            height={h}
            data-last={isLast || undefined}
            className={isLast ? "fill-primary-ink" : value <= 0 ? "fill-foreground/40" : "fill-foreground/75"}
          />
        );
      })}
    </>
  );
}

function Line({ values, max, peak, width, height }: Geometry & { peak: number }) {
  const span = Math.max(1, values.length - 1);
  const x = (i: number) => (values.length === 1 ? width : (i / span) * width);
  const y = (v: number) => height - (v / max) * (height - 2) - 1;
  const last = values[values.length - 1];
  const peakIndex = values.lastIndexOf(peak);
  return (
    <>
      <polyline
        fill="none"
        strokeWidth={1}
        className="stroke-foreground/75"
        points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
      />
      {peakIndex !== values.length - 1 ? (
        <circle cx={x(peakIndex)} cy={y(peak)} r={1.25} data-peak className="fill-foreground/70" />
      ) : null}
      <circle cx={x(values.length - 1)} cy={y(last)} r={1.75} data-last className="fill-primary-ink" />
    </>
  );
}
