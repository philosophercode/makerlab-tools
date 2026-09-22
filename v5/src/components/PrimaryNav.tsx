"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";
import { AdminLink } from "./AdminLink";
import { RefreshCatalogButton } from "./RefreshCatalogButton";
import { canAddEquipment } from "../lib/capabilities/access";
import { siteConfig } from "../lib/site-config";
import {
  fetchIdentity,
  firstNameOf,
  isSignedIn,
  signOutAndReload,
  startGoogleSignIn,
  type ClientIdentity,
  type SignInStart,
} from "../lib/auth/sign-in-client";

const LINKS = [
  { href: "/", key: "tools", match: (path: string) => path === "/" || path.startsWith("/tools") },
  { href: "/projects", key: "projects", match: (path: string) => path.startsWith("/projects") },
  { href: "/about", key: "about", match: (path: string) => path.startsWith("/about") },
] as const;

/** How long a sign-in notice stays before it fades. Long enough to read twice. */
export const SIGN_IN_NOTICE_MS = 6000;

export function PrimaryNav({ noticeDurationMs = SIGN_IN_NOTICE_MS }: { noticeDurationMs?: number } = {}) {
  const pathname = usePathname() || "/";
  const t = useTranslations("nav");
  const { open } = useChatLauncher();

  // Who is signed in is request state, and this header renders inside a
  // statically-shelled layout — so the control resolves itself after mount
  // (auth design spec §6). Until it answers, and whenever it cannot, the
  // visitor sees the sign-in control: anonymous is a first-class state here,
  // not a loading failure, and nothing on the page is gated behind signing in.
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  // Why the last sign-in attempt left the visitor here. A click that does
  // nothing looks broken; this says what happened, in a sentence, beside the
  // control.
  const [signInNotice, setSignInNotice] = useState<Exclude<SignInStart, "started"> | null>(null);

  // The notice is transient: it fades and goes after a few seconds rather than
  // sitting in the header for the rest of the visit.
  useEffect(() => {
    if (!signInNotice) return;
    const timer = setTimeout(() => setSignInNotice(null), noticeDurationMs);
    return () => clearTimeout(timer);
  }, [signInNotice, noticeDurationMs]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchIdentity(controller.signal).then((resolved) => {
      if (active) setIdentity(resolved);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const signedIn = isSignedIn(identity);
  const firstName = firstNameOf(identity?.name);

  async function handleSignIn() {
    setBusy(true);
    setSignInNotice(null);
    // Come back to the page the user started on, never to "/" (spec §10).
    const result = await startGoogleSignIn(pathname);
    // On success the browser is already leaving for Google; the rest only
    // matters when sign-in is unconfigured or the request failed.
    if (result !== "started") {
      setBusy(false);
      setSignInNotice(result);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    await signOutAndReload();
  }

  return (
    <nav className="primary-nav" aria-label={t("primaryNavLabel")}>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.match(pathname) ? "is-active" : undefined}
        >
          {t(link.key)}
        </Link>
      ))}
      {/* Adding equipment needs `tools.add` (spec §3.5), so the entry point
          waits for an identity that holds it. The chat enforces the same
          declaration server-side; hiding the button is only presentation. */}
      {/* The way into `/admin`, for anyone holding an admin-surface permission
          (spec §6). Like every other control here it is presentation: the
          layout behind it resolves the identity again and refuses. */}
      <AdminLink role={identity?.role} />
      {canAddEquipment(identity) ? (
        /* Same nav-action chrome as Report: an action, not a page. */
        <button
          type="button"
          className="primary-nav-report primary-nav-add"
          onClick={() => open(t("addSeed"))}
          aria-label={t("addAria")}
        >
          {t("add")}
        </button>
      ) : null}
      <button
        type="button"
        className="primary-nav-report"
        onClick={() => open(t("reportSeed"))}
        aria-label={t("reportAria")}
      >
        {t("report")}
      </button>
      {/* Staff-only, and it renders nothing for everyone else. The header is
          where it belongs: the catalog is what every page shows, so the control
          that refreshes it should not live on one of them. It reuses the
          identity this component already resolved rather than asking again. */}
      <RefreshCatalogButton role={identity?.role} />
      {signedIn ? (
        <>
          {/* Name only — no avatar image, per the technical-schematic system
              (spec §6). The nav's own mono/uppercase/0-radius treatment applies. */}
          {firstName ? (
            <span
              className="primary-nav-identity"
              aria-label={t("signedInAria", { name: firstName })}
            >
              {firstName}
            </span>
          ) : null}
          <button
            type="button"
            // Borrows the report control's chrome: same nav-action treatment
            // (transparent, 0 radius, inherited mono label). The modifier class
            // is the hook if the two ever need to diverge.
            className="primary-nav-report primary-nav-auth"
            onClick={handleSignOut}
            disabled={busy}
          >
            {t("signOut")}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="primary-nav-report primary-nav-auth"
            onClick={handleSignIn}
            disabled={busy}
            aria-label={t("signInAria", { institution: siteConfig.institution })}
          >
            {t("signIn")}
          </button>
          {signInNotice ? (
            <span
              role="status"
              className="primary-nav-notice"
              style={{ animationDuration: `${noticeDurationMs}ms` }}
            >
              {t(signInNotice === "unconfigured" ? "signInUnconfigured" : "signInFailed")}
            </span>
          ) : null}
        </>
      )}
    </nav>
  );
}
