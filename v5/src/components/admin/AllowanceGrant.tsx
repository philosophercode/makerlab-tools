"use client";

import "../../styles/admin-import.css";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { AllowanceCandidate, GrantAllowanceAction } from "../../app/admin/users/allowance-result";
import {
  SETUP_ALLOWANCE_DEFAULT_DAYS,
  SETUP_ALLOWANCE_DEFAULT_ITEMS,
  SETUP_ALLOWANCE_MAX_DAYS,
  SETUP_ALLOWANCE_MAX_ITEMS,
} from "../../lib/import/limits";
import { RESEARCH_DAILY_ITEM_LIMIT } from "../../lib/intake/limits";

/**
 * **Setup allowances** on `/admin/users` (bulk intake spec §4.2): a super admin
 * gives whoever is loading the inventory extra research items for a while —
 * +400 for 7 days by default — on top of the daily 100. The people listed are
 * the ones who may add equipment; each shows what they hold now. The action
 * arrives as a prop and checks `users.manage` itself.
 */
export function AllowanceGrant({ candidates, grant }: { candidates: AllowanceCandidate[]; grant: GrantAllowanceAction }) {
  const t = useTranslations("admin.import.allowance");
  const format = useFormatter();
  const [userId, setUserId] = useState(candidates[0]?.id ?? "");
  const [items, setItems] = useState(SETUP_ALLOWANCE_DEFAULT_ITEMS);
  const [days, setDays] = useState(SETUP_ALLOWANCE_DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "status" | "error" | "warning"; key: string; until?: string } | null>(null);

  if (candidates.length === 0) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const result = await grant({ userId, extraItems: items, days });
      if (!result.ok) setStatus({ tone: "error", key: `errors.${result.error}` });
      else setStatus({ tone: result.warning ? "warning" : "status", key: "granted", until: result.expiresAt });
    } catch {
      setStatus({ tone: "error", key: "errors.failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-import-section" aria-labelledby="allowance-title">
      <h3 id="allowance-title">{t("title")}</h3>
      <p className="admin-intake-hint">{t("lede", { base: RESEARCH_DAILY_ITEM_LIMIT })}</p>
      <ul className="admin-import-list">
        {candidates
          .filter((person) => person.activeExtra > 0 && person.activeUntil)
          .map((person) => (
            <li key={person.id} className="admin-import-list-row">
              <span>{person.name || person.email}</span>
              <span className="admin-state">
                {t("active", {
                  items: person.activeExtra,
                  date: format.dateTime(new Date(person.activeUntil as string), { dateStyle: "medium" }),
                })}
              </span>
            </li>
          ))}
      </ul>
      <form className="admin-import-toolbar" onSubmit={(event) => void submit(event)}>
        <label className="admin-visually-hidden" htmlFor="allowance-person">
          {t("person")}
        </label>
        <select id="allowance-person" value={userId} disabled={busy} onChange={(event) => setUserId(event.target.value)}>
          {candidates.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name ? `${person.name} (${person.email})` : person.email}
            </option>
          ))}
        </select>
        <label htmlFor="allowance-items">{t("items")}</label>
        <input
          id="allowance-items"
          type="number"
          min={1}
          max={SETUP_ALLOWANCE_MAX_ITEMS}
          value={items}
          disabled={busy}
          onChange={(event) => setItems(Number(event.target.value))}
        />
        <label htmlFor="allowance-days">{t("days")}</label>
        <input
          id="allowance-days"
          type="number"
          min={1}
          max={SETUP_ALLOWANCE_MAX_DAYS}
          value={days}
          disabled={busy}
          onChange={(event) => setDays(Number(event.target.value))}
        />
        <button type="submit" className="admin-button is-primary" disabled={busy || !userId}>
          {t("grant", { items, days })}
        </button>
      </form>
      {status ? (
        <p
          className={`admin-row-status${status.tone === "error" ? " is-error" : status.tone === "warning" ? " is-warning" : ""}`}
          role="status"
        >
          {status.key === "granted"
            ? t(status.tone === "warning" ? "grantedUnaudited" : "granted", {
                date: format.dateTime(new Date(status.until as string), { dateStyle: "medium" }),
              })
            : t(status.key)}
        </p>
      ) : null}
    </section>
  );
}
