"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MenuIcon, XIcon } from "lucide-react";
import { ADMIN_HREF, AdminLink } from "./AdminLink";
import { NavMenuAccount } from "./NavMenuAccount";
import { ProfileMenu } from "./ProfileMenu";
import { FROSTED } from "./system/frosted";
import { useNavMenu } from "./use-nav-menu";
import { siteConfig } from "../lib/site-config";
import {
  DEV_SIGN_IN_ENDPOINT,
  isSignedIn,
  startGoogleSignIn,
  type ClientIdentity,
  type SignInStart,
} from "../lib/auth/sign-in-client";
import { loadSharedIdentity } from "../lib/auth/identity-store";

const LINKS = [
  { href: "/", key: "tools", match: (path: string) => path === "/" || path.startsWith("/tools") },
  { href: "/map", key: "map", match: (path: string) => path.startsWith("/map") },
  { href: "/projects", key: "projects", match: (path: string) => path.startsWith("/projects") },
  { href: "/about", key: "about", match: (path: string) => path.startsWith("/about") },
] as const;

/** How long a sign-in notice stays before it fades. Long enough to read twice. */
export const SIGN_IN_NOTICE_MS = 6000;

interface PrimaryNavProps {
  noticeDurationMs?: number;
  /**
   * The language and theme controls as rows, for the phone bar's MENU (DESIGN.md
   * §8.12, amendment "The phone bar"). `GlobalChrome` passes them; the bar's
   * own copies sit in its utility controls.
   */
  menuPreferences?: ReactNode;
}

export function PrimaryNav({ noticeDurationMs = SIGN_IN_NOTICE_MS, menuPreferences }: PrimaryNavProps = {}) {
  const pathname = usePathname() || "/";
  const t = useTranslations("nav");
  const { isOpen: menuOpen, toggle: toggleMenu, close: closeMenu, toggleRef, panelRef } = useNavMenu();
  const linksId = useId();

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
    let active = true;
    // One request per page load, shared with the ⌘K palette, the tool page's
    // Edit control and the project form (performance plan, quick win 10).
    void loadSharedIdentity().then((resolved) => {
      if (active) setIdentity(resolved);
    });
    return () => {
      active = false;
    };
  }, []);

  const signedIn = isSignedIn(identity);

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
      // From the phone bar's MENU: close it, so the notice under the bar shows.
      if (menuOpen) closeMenu(true);
    }
  }

  const signInLabel = t("signInAria", { institution: siteConfig.institution });
  const devSignInHref = `${DEV_SIGN_IN_ENDPOINT}?next=${encodeURIComponent(pathname)}`;

  return (
    <nav className="primary-nav" aria-label={t("primaryNavLabel")}>
      {/* MENU, on a phone (☰, its word kept for assistive technology) and on
          a short viewport (a phone on its side) — DESIGN.md §8.12; CSS draws
          it there and nowhere else. Elsewhere the links' wrapper is
          `display: contents`, so they sit in the bar exactly as they did
          before it existed. */}
      <button
        ref={toggleRef}
        type="button"
        className="primary-nav-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls={linksId}
        onClick={toggleMenu}
      >
        {menuOpen ? <XIcon aria-hidden="true" /> : <MenuIcon aria-hidden="true" />}
        <span className="primary-nav-menu-label">{t("menu")}</span>
      </button>
      <div
        ref={panelRef}
        id={linksId}
        className={`primary-nav-links ${FROSTED}`}
        data-open={menuOpen ? "true" : undefined}
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={link.match(pathname) ? "is-active" : undefined}
            onClick={() => closeMenu(false)}
          >
            {t(link.key)}
          </Link>
        ))}
        {/* ADMIN, for the people who can reach `/admin` — where REPORT used to
            be (Isaac, 2026-10-07). Reporting lives on the tool page, the QR
            arrival notice, the footer and the chat. `AdminLink` renders
            nothing for anyone else, and nothing until the identity answers. */}
        {signedIn && identity ? (
          <AdminLink
            role={identity.role}
            className={
              pathname === ADMIN_HREF || pathname.startsWith(`${ADMIN_HREF}/`)
                ? "primary-nav-admin is-active"
                : "primary-nav-admin"
            }
            onClick={() => closeMenu(false)}
          />
        ) : null}
        {/* What the phone bar has no room for (amendment "The phone bar",
            2026-10-10): the account — or Sign in — then the language and
            theme. Drawn while MENU is open, and by CSS on a phone only: the
            short bar and every wider bar keep these controls in the bar, so
            the rest of the time each control exists once. */}
        {menuOpen ? (
          <div className="primary-nav-menu-more">
            {signedIn && identity ? (
              <NavMenuAccount identity={identity} onNavigate={() => closeMenu(false)} />
            ) : (
              <div className="primary-nav-menu-account">
                <button
                  type="button"
                  className="primary-nav-menu-row"
                  onClick={handleSignIn}
                  disabled={busy}
                  aria-label={signInLabel}
                >
                  {t("signIn")}
                </button>
                {identity?.devSignIn ? (
                  <a className="primary-nav-menu-row" href={devSignInHref} aria-label={t("devSignIn")}>
                    {t("devSignIn")}
                  </a>
                ) : null}
              </div>
            )}
            {menuPreferences ? <div className="primary-nav-menu-prefs">{menuPreferences}</div> : null}
          </div>
        ) : null}
      </div>
      {/* Everything else a signed-in person can do beyond browsing — Add
          equipment, their account, connecting an assistant, Sign out — lives
          in their profile menu, not the bar (Isaac, 2026-09-23; ADMIN moved
          back to the bar on 2026-10-07). Refresh moved to `/admin`.
          The control shows the Google photo beside the first name. It used to
          be name only, with no avatar image, per the technical-schematic system
          (spec §6); Isaac chose a square avatar on 2026-09-23, and it keeps the
          system's 0 radius. */}
      {signedIn && identity ? (
        <ProfileMenu identity={identity} />
      ) : (
        <>
          <button
            type="button"
            className="primary-nav-button primary-nav-auth"
            onClick={handleSignIn}
            disabled={busy}
            aria-label={signInLabel}
          >
            {t("signIn")}
          </button>
          {/* Development-only sign-in (auth spec amendment 2026-09-24). Shown
              only when `/api/identity` says every server-side guard passed for
              this request; the route checks them all again. A plain anchor,
              not a Link: it is a full navigation that sets a cookie. */}
          {identity?.devSignIn ? (
            <a
              className="primary-nav-button primary-nav-dev-sign-in"
              href={devSignInHref}
              aria-label={t("devSignIn")}
            >
              {/* Short below xl, where the one-row bar is tight (DESIGN.md §8.12). */}
              <span className="xl:hidden">{t("devSignInShort")}</span>
              <span className="hidden xl:inline">{t("devSignIn")}</span>
            </a>
          ) : null}
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
