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
        <MirrorNotice title={t("mirror.keyUnavailableTitle")}>{t("mirror.keyUnavailableBody")}</MirrorNotice>
        {view ? <MirrorStatus view={view} timeZone={timeZone} /> : null}
      </MirrorSection>
    );
  }

  if (!view) {
    return (
      <MirrorSection view={view}>
        <section className="ui flex flex-col gap-3" aria-labelledby="mirror-howto-title">
          <h3 id="mirror-howto-title" className="font-heading text-lg font-medium uppercase">
            {t("mirror.howToTitle")}
          </h3>
          <ol className="flex max-w-[72ch] list-none flex-col text-sm">
            {(["howToIntegration", "howToPage", "howToShare", "howToPaste"] as const).map((step, index) => (
              <li key={step} className="flex gap-3 border-b border-rule py-1.5 last:border-b-0">
                {/* The number is metadata: mono, tabular, muted — the step is the words. */}
                <span aria-hidden="true" className="w-4 shrink-0 font-mono text-label text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span>{t(`mirror.${step}`)}</span>
              </li>
            ))}
          </ol>
          <MirrorPrivacyNote />
        </section>
        <MirrorConnect actions={actions} />
      </MirrorSection>
    );
  }

  const needsToken = !view.connected || (view.lastError !== null && TOKEN_ERRORS.has(view.lastError.code));

  if (needsToken) {
    return (
      <MirrorSection view={view}>
        <MirrorNotice title={t("mirror.needsTokenTitle")}>
          {t(view.connected ? "mirror.needsTokenRejected" : "mirror.needsTokenDisconnected")}
        </MirrorNotice>
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
      <MirrorPrivacyNote />
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

/**
 * A state the page is in rather than an outcome of a click: no key to encrypt
 * with, or a token Notion no longer takes. A warn rule down its start edge and
 * the words — never colour alone (DESIGN.md §8.9).
 */
function MirrorNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="ui flex flex-col gap-1 border-s-2 border-s-warn bg-muted px-4 py-3">
      <h3 className="font-heading text-base font-medium uppercase">{title}</h3>
      <p className="max-w-[72ch] text-sm">{children}</p>
    </div>
  );
}

/** Who can read the mirror's workspace: said on every state that can push. */
async function MirrorPrivacyNote() {
  const t = await getTranslations("admin");
  return <p className="ui max-w-[72ch] text-xs leading-snug text-muted-foreground">{t("mirror.privacyNote")}</p>;
}
