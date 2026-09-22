import { useTranslations } from "next-intl";
import type { UnlinkedUnit } from "../../lib/data/inventory";

/**
 * Units that belong to no tool (spec §4.5, and the last of §5.3(a)2's
 * "Needs attention" signals).
 *
 * It sits beside the table rather than in it, because a unit with no tool is
 * not a row of the tool list — attaching it to a guessed tool would be the
 * plausible fiction Article 4 forbids. It is also deliberately outside the
 * filters: these machines are invisible in the catalogue whatever the table is
 * showing, and a filter that hid them would hide the one thing nobody else is
 * going to notice.
 *
 * Renders nothing at all when every unit has a tool — a heading announcing an
 * empty list is noise on the page a reviewer uses every week.
 */

export interface UnlinkedUnitsProps {
  units: UnlinkedUnit[];
}

export function UnlinkedUnits({ units }: UnlinkedUnitsProps) {
  const t = useTranslations("admin.inventory");
  if (units.length === 0) return null;

  return (
    <section className="admin-unlinked" aria-labelledby="unlinked-units-title">
      <h3 id="unlinked-units-title">{t("unlinkedTitle")}</h3>
      <p className="admin-lede">{t("unlinkedLede")}</p>
      <ul className="admin-unlinked-list">
        {units.map((unit) => (
          <li key={unit.id}>
            <span className="admin-unlinked-label">{unit.unitLabel}</span>
            <span className="admin-cell-note">{identifier(unit, t)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The serial, else the asset tag, else the fact that it has neither — which is
 * itself worth saying, because a unit with no identifier is one nobody can
 * match to a machine on the floor.
 */
function identifier(
  unit: UnlinkedUnit,
  t: (key: string, values?: Record<string, string>) => string
): string {
  if (unit.serialNumber) return t("unlinkedSerial", { serial: unit.serialNumber });
  if (unit.assetTag) return t("unlinkedAssetTag", { assetTag: unit.assetTag });
  return t("unlinkedUnidentified");
}
