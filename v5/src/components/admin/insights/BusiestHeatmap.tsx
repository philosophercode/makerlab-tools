import { useTranslations } from "next-intl";

/**
 * Busiest times (usage insight spec §6): a 7 × 24 grid of assistant questions
 * and tool page views in lab time, Monday first.
 *
 * **The grid is the table.** It is a real `<table>` — days as row headers,
 * hours as column headers — and each cell carries its count as text for a
 * screen reader ("Tue 14:00 — 6"), so there is no separate fallback to drift
 * from the picture. The shade is the count over the busiest cell, drawn from
 * `--primary-ink` with `color-mix`, so it follows the theme. On a phone it
 * scrolls sideways inside its own box, never the page.
 */

const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function heatShade(count: number, max: number): string | undefined {
  if (count <= 0 || max <= 0) return undefined;
  const percent = Math.round(12 + (count / max) * 78);
  return `color-mix(in srgb, var(--primary-ink) ${percent}%, transparent)`;
}

export function BusiestHeatmap({ heatmap, timeZone }: { heatmap: number[][]; timeZone: string }) {
  const t = useTranslations("admin.insights.heatmap");
  const max = Math.max(0, ...heatmap.flat());
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div data-slot="busiest-heatmap" className="ui flex flex-col gap-2">
      <div className="max-w-full overflow-x-auto">
        <table aria-label={t("tableLabel")} className="border-separate border-spacing-[2px] text-[11px]">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                {t("day")}
              </th>
              {hours.map((hour) => (
                <th key={hour} scope="col" className="w-5 text-center font-mono font-normal text-muted-foreground">
                  {hour % 3 === 0 ? String(hour).padStart(2, "0") : <span className="sr-only">{hour}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ORDER.map((dow) => {
              const day = t(`days.${dow}`);
              return (
                <tr key={dow}>
                  <th scope="row" className="pe-2 text-start font-mono font-normal text-muted-foreground">
                    {day}
                  </th>
                  {hours.map((hour) => {
                    const count = heatmap[dow]?.[hour] ?? 0;
                    return (
                      <td
                        key={hour}
                        data-heat={`${dow}-${hour}`}
                        title={t("cell", { day, hour: String(hour).padStart(2, "0"), count })}
                        className="h-5 w-5 border border-rule"
                        style={{ background: heatShade(count, max) }}
                      >
                        <span className="sr-only">{t("cell", { day, hour: String(hour).padStart(2, "0"), count })}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("note", { timeZone })}</p>
    </div>
  );
}
