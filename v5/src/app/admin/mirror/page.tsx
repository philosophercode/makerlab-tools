import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { EmptyState } from "../../../components/system/EmptyState";
import { MirrorConnect } from "../../../components/admin/MirrorConnect";
import { MirrorControls } from "../../../components/admin/MirrorControls";
import { MirrorMapping } from "../../../components/admin/MirrorMapping";
import { MirrorStatus } from "../../../components/admin/MirrorStatus";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { getMirrorViewForOwner } from "../../../lib/data/mirrors";
import { labTimezone } from "../../../lib/lab-time";
import { mirrorKeyAvailable } from "../../../lib/mirror/token-crypto";
import type { MirrorView } from "../../../lib/mirror/types";
import { siteConfig } from "../../../lib/site-config";
import {
  connect,
  createDatabases,
  disconnect,
  saveMapping,
  setPaused,
  syncNow,
  testConnection,
} from "./actions";
import type { MirrorActions } from "./action-result";

/**
 * `/admin/mirror` — the signed-in admin's own Notion mirror (spec §3.8, §5.8,
 * §6, §8).
 *
 * Requires `mirror.manage`. The layout above let anyone holding an admin
 * permission through; the exact refusal happens here and is *said*, never a
 * 404.
 *
 * **Owner-only by construction.** The page reads one row —
 * `getMirrorViewForOwner(identity.userId)` — so it cannot show anybody else's
 * mirror, and the actions it hands down take no mirror id at all (§8). When
 * Niti opens this page she sees her own mirror, or the form to make one;
 * Isaac's is not hers to see (§3.8 "Owners").
 *
 * **No Notion call happens during render.** Status is what the last push
 * recorded; the page is a settings page over a database row, and Notion being
 * down changes nothing about whether it renders (§5.8).
 *
 * The states, in the order they are decided:
 *
 * - **No `AUTH_SECRET`** — a token cannot be encrypted, so there is no form to
 *   fill; the page says why instead (§8 "Secrets at rest").
 * - **No mirror yet** — the §4.14 steps and `MirrorConnect`.
 * - **A mirror whose token is gone or refused** — disconnected, or its last
 *   push failed `unauthorized` / `token_unreadable` (§5.8): "the connection
 *   needs a new token", `MirrorConnect` again, and the mapping shown and kept
 *   so reconnecting duplicates nothing.
 * - **Connected** — `MirrorStatus`, `MirrorControls`, `MirrorMapping`.
 *
 * **A database that cannot be reached is said, not papered over** (§6 States).
 */

export const metadata = {
  title: `Notion mirror — ${siteConfig.name}`,
};

/** The last push failed because of the token itself; a new one is the fix. */
const TOKEN_ERRORS: ReadonlySet<string> = new Set(["unauthorized", "token_unreadable"]);

export default async function AdminMirrorPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "mirror.manage") || !identity.userId) return <AdminNotice kind="forbidden" />;

  let view: MirrorView | null;
  try {
    view = await getMirrorViewForOwner(identity.userId);
  } catch (err) {
    console.error("[admin/mirror] could not read the mirror", err);
    return (
      <MirrorSection view={undefined}>
        <EmptyState tone="bad">{t("mirror.unavailable")}</EmptyState>
      </MirrorSection>
    );
  }

  const actions: MirrorActions = {
    testConnection,
    connect,
    createDatabases,
    saveMapping,
    syncNow,
    setPaused,
    disconnect,
  };
  const timeZone = labTimezone();

  if (!mirrorKeyAvailable()) {
    return (
      <MirrorSection view={view}>
        <div className="admin-mirror-notice" role="status">
          <h3>{t("mirror.keyUnavailableTitle")}</h3>
          <p>{t("mirror.keyUnavailableBody")}</p>
        </div>
        {view ? <MirrorStatus view={view} timeZone={timeZone} /> : null}
      </MirrorSection>
    );
  }

  if (!view) {
    return (
      <MirrorSection view={view}>
        <section className="admin-mirror-panel" aria-labelledby="mirror-howto-title">
          <h3 id="mirror-howto-title">{t("mirror.howToTitle")}</h3>
          <ol className="admin-mirror-steps">
            <li>{t("mirror.howToIntegration")}</li>
            <li>{t("mirror.howToPage")}</li>
            <li>{t("mirror.howToShare")}</li>
            <li>{t("mirror.howToPaste")}</li>
          </ol>
          <p className="admin-mirror-hint">{t("mirror.privacyNote")}</p>
        </section>
        <MirrorConnect actions={actions} />
      </MirrorSection>
    );
  }

  const needsToken = !view.connected || (view.lastError !== null && TOKEN_ERRORS.has(view.lastError.code));

  if (needsToken) {
    return (
      <MirrorSection view={view}>
        <div className="admin-mirror-notice" role="status">
          <h3>{t("mirror.needsTokenTitle")}</h3>
          <p>{t(view.connected ? "mirror.needsTokenRejected" : "mirror.needsTokenDisconnected")}</p>
        </div>
        <MirrorConnect actions={actions} initialPageUrl={view.parentPageId} />
        <MirrorStatus view={view} timeZone={timeZone} />
        {view.connected ? <MirrorControls view={view} actions={actions} /> : null}
        <MirrorMapping mapping={view.mapping} editable={false} actions={actions} />
      </MirrorSection>
    );
  }

  return (
    <MirrorSection view={view}>
      <MirrorStatus view={view} timeZone={timeZone} />
      <MirrorControls view={view} actions={actions} />
      <MirrorMapping mapping={view.mapping} editable actions={actions} />
      <p className="admin-mirror-hint">{t("mirror.privacyNote")}</p>
    </MirrorSection>
  );
}

/**
 * The page's header, shared by every state. Its facts line is the mirror's
 * state in words — the home tile's words — and the last push, when there was
 * one. `view` is `undefined` when the row could not be read, `null` when there
 * is no mirror yet.
 */
async function MirrorSection({ view, children }: { view: MirrorView | null | undefined; children: React.ReactNode }) {
  const t = await getTranslations("admin");
  const facts =
    view === undefined
      ? [t("facts.unreadable")]
      : [
          t(
            `home.mirror.${!view?.connected ? "notConnected" : view.paused ? "paused" : view.lastStatus === "failed" ? "failed" : "connected"}`
          ),
          view?.lastSyncedAt ? t("facts.lastPush", { date: view.lastSyncedAt.slice(0, 10) }) : null,
        ];
  return (
    <section className="flex flex-col gap-5">
      <AdminPageHeader surface="mirror" title={t("mirrorTitle")} lede={t("mirrorLede")} facts={facts} />
      {children}
    </section>
  );
}
