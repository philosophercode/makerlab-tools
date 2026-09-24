import "../../styles/admin-import.css";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { importPath, type ImportView } from "../../lib/import/view";

/**
 * The "Imports" section of `/admin/intake` (bulk intake spec §6): an **Import
 * a list** button beside the queue, and the recent imports with their counts —
 * a half-reviewed import waits here to be picked up again (§2 "Imports are
 * resumable").
 */
export function ImportsList({ imports, canImport }: { imports: ImportView[] | null; canImport: boolean }) {
  const t = useTranslations("admin.import");
  return (
    <section className="admin-import-section" aria-labelledby="imports-title">
      <header className="admin-import-section-head">
        <h3 id="imports-title">{t("sectionTitle")}</h3>
        {canImport ? (
          <Link className="admin-button is-primary" href="/admin/intake/imports/new">
            {t("importButton")}
          </Link>
        ) : null}
      </header>
      {imports === null ? (
        <p className="admin-empty td-empty" role="alert">
          {t("sectionUnavailable")}
        </p>
      ) : imports.length === 0 ? (
        <p className="admin-intake-hint">{t("sectionEmpty")}</p>
      ) : (
        <ul className="admin-import-list">
          {imports.map((item) => (
            <li key={item.id} className="admin-import-list-row">
              <h4>
                <Link href={importPath(item.id)}>{item.sourceName ?? t(`source.${item.sourceKind}`)}</Link>
              </h4>
              <span className={`admin-state is-${item.status}`}>{t(`status.${item.status}`)}</span>
              <p className="admin-queue-meta">
                {item.status === "ready"
                  ? t("listCounts", { items: item.itemCount, duplicates: item.duplicateCount })
                  : null}
                {item.createdByName ? ` · ${item.createdByName}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
