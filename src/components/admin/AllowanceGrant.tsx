"use client";

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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusGlyph } from "../system/StatusGlyph";

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
    <section className="ui mt-8 flex flex-col gap-3" aria-labelledby="allowance-title">
      <h3 id="allowance-title" className="font-heading text-lg font-medium uppercase">
        {t("title")}
      </h3>
      <p className="max-w-[72ch] text-sm text-muted-foreground">{t("lede", { base: RESEARCH_DAILY_ITEM_LIMIT })}</p>
      <ul className="flex flex-col">
        {candidates
          .filter((person) => person.activeExtra > 0 && person.activeUntil)
          .map((person) => (
            <li key={person.id} className="flex flex-wrap items-baseline gap-3 border-b border-rule py-1.5 text-table">
              <span>{person.name || person.email}</span>
              <StatusGlyph
                tone="ok"
                label={t("active", {
                  items: person.activeExtra,
                  date: format.dateTime(new Date(person.activeUntil as string), { dateStyle: "medium" }),
                })}
              />
            </li>
          ))}
      </ul>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void submit(event)}>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="allowance-person" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("person")}
          </label>
          <NativeSelect id="allowance-person" value={userId} disabled={busy} onChange={(event) => setUserId(event.target.value)}>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ? `${person.name} (${person.email})` : person.email}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="allowance-items" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("items")}
          </label>
          <Input
            id="allowance-items"
            type="number"
            min={1}
            max={SETUP_ALLOWANCE_MAX_ITEMS}
            value={items}
            disabled={busy}
            className="w-24 font-mono tabular-nums"
            onChange={(event) => setItems(Number(event.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="allowance-days" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("days")}
          </label>
          <Input
            id="allowance-days"
            type="number"
            min={1}
            max={SETUP_ALLOWANCE_MAX_DAYS}
            value={days}
            disabled={busy}
            className="w-20 font-mono tabular-nums"
            onChange={(event) => setDays(Number(event.target.value))}
          />
        </div>
        <Button type="submit" variant="default" disabled={busy || !userId}>
          {t("grant", { items, days })}
        </Button>
      </form>
      {status ? (
        <p
          className={cn("text-xs", status.tone === "error" ? "text-bad" : status.tone === "warning" ? "text-warn" : "text-muted-foreground")}
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
