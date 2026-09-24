import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { InventoryAttention, InventoryRow } from "../../lib/data/inventory";

/**
 * The review table on `/admin/inventory` (spec §5.3(a)1).
 *
 * A component with no `async` and no data access of its own, for the reason
 * `UsersTable` is: everything it needs is a prop, so a component test mounts it
 * with the ordinary i18n wrapper, and the client island that filters the rows
 * can render it directly.
 *
 * **It never invents a photo.** The catalogue falls back to a bundled image
 * named after the tool, which is right for a visitor and wrong here: the whole
 * point of the "no photo" flag is that somebody has to go and take one. A tool
 * with no public attachment gets a marked empty frame instead.
 *
 * **Dates are ISO** — the same locale-neutral mono treatment the roster gives
 * them. A review table is read by two or three people who compare stamps; a
 * formatted date would also render differently on the server and the client.
 */

export interface InventoryTableProps {
  rows: InventoryRow[];
  /**
   * Open the tool editor on this row, or undefined when the surface offers no
   * editor. The table stays presentational either way: the panel's state
   * belongs to the island that owns the rows, not to the markup showing them.
   */
  onEdit?: (row: InventoryRow) => void;
  /**
   * What to say when there is nothing to show. The caller owns this string
   * because only the filter console knows *why* the table is empty, and
   * "no results" on its own tells a reviewer nothing (spec §6, States).
   */
  emptyMessage: string;
  /**
   * Row selection for **Refresh research** (refresh research spec §6): when
   * `onToggle` is given, each row gets a checkbox. The island owns the set.
   */
  selected?: ReadonlySet<string>;
  onToggle?: (row: InventoryRow) => void;
}

/** The flags that are plain booleans, in the order the badges read. */
const PLAIN_FLAGS: ReadonlyArray<Exclude<keyof InventoryAttention, "openTickets">> = [
  "noPhoto",
  "noManual",
  "neverReviewed",
  "floorCheck",
];

const FLAG_KEYS: Record<(typeof PLAIN_FLAGS)[number], string> = {
  noPhoto: "no_photo",
  noManual: "no_manual",
  neverReviewed: "never_reviewed",
  floorCheck: "floor_check",
};

export function InventoryTable({ rows, emptyMessage, onEdit, selected, onToggle }: InventoryTableProps) {
  const t = useTranslations("admin.inventory");

  if (rows.length === 0) {
    return <p className="admin-empty td-empty">{emptyMessage}</p>;
  }

  return (
    <div className="admin-table-scroll">
      <table className="admin-table admin-inventory-table" aria-label={t("tableLabel")}>
        <thead>
          <tr>
            {onToggle ? (
              <th scope="col" className="admin-select-cell">
                <span className="admin-visually-hidden">{t("columnSelect")}</span>
              </th>
            ) : null}
            <th scope="col">{t("columnPhoto")}</th>
            <th scope="col">{t("columnTool")}</th>
            <th scope="col">{t("columnCategory")}</th>
            <th scope="col">{t("columnLocation")}</th>
            <th scope="col">{t("columnUnits")}</th>
            <th scope="col">{t("columnState")}</th>
            <th scope="col">{t("columnReviewed")}</th>
            <th scope="col">{t("columnUpdated")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.state === "archived" ? "is-archived" : undefined}>
              {onToggle ? (
                <td className="admin-select-cell" data-label={t("columnSelect")}>
                  <input
                    type="checkbox"
                    checked={selected?.has(row.id) ?? false}
                    onChange={() => onToggle(row)}
                    aria-label={t("selectRow", { name: row.name })}
                  />
                </td>
              ) : null}
              <td data-label={t("columnPhoto")}>
                {row.photoUrl ? (
                  <span className="admin-thumb">
                    <Image
                      src={row.photoUrl}
                      alt=""
                      fill
                      sizes="48px"
                      style={{ objectFit: "cover" }}
                      unoptimized
                    />
                  </span>
                ) : (
                  <span className="admin-thumb is-empty" role="img" aria-label={t("noPhoto")}>
                    <span aria-hidden="true">+</span>
                  </span>
                )}
              </td>

              <th scope="row">
                {/* Two ways in from one cell: the name opens the public page,
                    which is where a reviewer checks their own work, and Edit
                    opens the panel over this table without losing the filters. */}
                <Link className="admin-inventory-name" href={`/tools/${row.slug}`}>
                  {row.name}
                </Link>
                {onEdit ? (
                  <button
                    type="button"
                    className="admin-button admin-inventory-edit"
                    onClick={() => onEdit(row)}
                  >
                    {t("edit")}
                  </button>
                ) : null}
                {row.openRefreshId ? (
                  <Link className="admin-refresh-open-tag" href={`/admin/refresh/${row.openRefreshId}`}>
                    {t("refreshOpen")}
                  </Link>
                ) : null}
                <AttentionBadges row={row} />
              </th>

              <td data-label={t("columnCategory")}>
                {row.categoryName ?? <span className="admin-muted">{t("uncategorized")}</span>}
                {row.categoryGroup ? (
                  <span className="admin-cell-note">{row.categoryGroup}</span>
                ) : null}
              </td>

              <td data-label={t("columnLocation")}>
                {row.room ?? <span className="admin-muted">{t("unplaced")}</span>}
                {row.zone ? <span className="admin-cell-note">{row.zone}</span> : null}
              </td>

              <td data-label={t("columnUnits")}>
                {row.unitCount === 0 ? (
                  <span className="admin-muted">{t("noUnits")}</span>
                ) : (
                  <>
                    <span className="admin-unit-count">{row.unitCount}</span>
                    {row.worstUnitStatus ? (
                      <span className="admin-cell-note">
                        {t(`unitStatus.${row.worstUnitStatus}`)}
                      </span>
                    ) : null}
                  </>
                )}
              </td>

              <td data-label={t("columnState")}>
                <span className={`admin-state is-${row.state}`}>{t(`state.${row.state}`)}</span>
              </td>

              <td className="admin-date" data-label={t("columnReviewed")}>
                {row.lastReviewedAt ? isoDay(row.lastReviewedAt) : t("never")}
              </td>

              <td className="admin-date" data-label={t("columnUpdated")}>
                {isoDay(row.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Why this row is in the queue, said on the row rather than in a column of its
 * own: a reviewer filtering by one flag still needs to see the other three,
 * because "no photo and no manual" is one trip to the lab, not two.
 */
function AttentionBadges({ row }: { row: InventoryRow }) {
  const t = useTranslations("admin.inventory");
  if (!row.needsAttention) return null;

  return (
    <ul className="admin-attention" aria-label={t("attentionLabel")}>
      {PLAIN_FLAGS.filter((flag) => row.attention[flag]).map((flag) => (
        <li key={flag} className="admin-attention-flag">
          {t(`flags.${FLAG_KEYS[flag]}`)}
        </li>
      ))}
      {row.attention.openTickets ? (
        <li className="admin-attention-flag is-tickets">
          {t("openTicketsWithCount", { count: row.openTicketCount })}
        </li>
      ) : null}
    </ul>
  );
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
