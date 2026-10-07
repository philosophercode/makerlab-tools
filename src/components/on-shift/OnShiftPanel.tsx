import { getFormatter, getTranslations } from "next-intl/server";
import { setMyShift } from "../../app/account/shift-actions";
import type { Identity } from "../../lib/auth/identity";
import { getOwnShiftEnd } from "../../lib/data/staff-shifts";
import { labTimezone } from "../../lib/lab-time";
import { shiftDisplayName } from "../../lib/on-shift/names";
import { loadOnShiftNames } from "../../lib/on-shift/read";
import { knownZone } from "../../lib/on-shift/time";
import { OnShiftControl } from "./OnShiftControl";

/**
 * What a staff member sees about shifts (on-shift spec 2026-10-07 §6): who
 * students see on shift right now, then their own **On shift** control. The
 * page decides whether to render it (`can(identity, "shifts.set")`) and
 * frames it: a card on the admin overview, a section on `/account`.
 *
 * A read that fails shows the control as off shift with the reason, rather
 * than claiming a state it did not read (Article 4).
 */
export async function OnShiftPanel({ identity, nameHref }: { identity: Identity; nameHref: string }) {
  const [t, format] = await Promise.all([getTranslations("admin.onShift"), getFormatter()]);
  const userId = identity.userId;
  let endsAt: string | null = null;
  let unreadable = false;
  if (userId) {
    try {
      endsAt = await getOwnShiftEnd(userId);
    } catch (err) {
      console.error("[on-shift] could not read the caller's shift", err);
      unreadable = true;
    }
  }
  const names = await loadOnShiftNames();

  return (
    <div className="flex flex-col gap-3">
      <p data-slot="on-shift-everyone" className="text-sm text-muted-foreground">
        {names.length > 0 ? t("everyone", { names: format.list(names, { type: "conjunction" }) }) : t("nobody")}
      </p>
      {unreadable ? <p className="text-sm text-warn">{t("unreadable")}</p> : null}
      <OnShiftControl
        endsAt={endsAt}
        shownAs={shiftDisplayName(identity.name)}
        timeZone={knownZone(labTimezone())}
        nameHref={nameHref}
        action={setMyShift}
      />
    </div>
  );
}
