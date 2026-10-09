import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { loadOnShiftNames } from "../../lib/on-shift/read";
import { OnShiftLine } from "./OnShiftLine";

/**
 * "On shift now: Alex M." on a public page (on-shift spec 2026-10-07 §6): the
 * home page under the title, and a tool page under its buttons. Nothing at
 * all when nobody is on shift: never a stand-in name, never "nobody".
 *
 * A dynamic hole: the page passes it inside its own `Suspense`, so the cached
 * shell everybody gets stays cached and only this line is read per request.
 * `connection()` makes it dynamic before the clock is read; the roster
 * itself is a cached read (`lib/on-shift/read.ts`), and shifts that have
 * ended are dropped against this request's clock.
 */
export async function OnShiftNow({ className }: { className?: string }) {
  await connection();
  const names = await loadOnShiftNames();
  if (names.length === 0) return null;
  const [t, format] = await Promise.all([getTranslations("status"), getFormatter()]);
  return <OnShiftLine className={className} text={t("onShiftNow", { names: format.list(names, { type: "conjunction" }) })} />;
}
