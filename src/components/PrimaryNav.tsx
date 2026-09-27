"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";
import { ProfileMenu } from "./ProfileMenu";
import { siteConfig } from "../lib/site-config";
import {
  DEV_SIGN_IN_ENDPOINT,
  fetchIdentity,
  isSignedIn,
  startGoogleSignIn,
  type ClientIdentity,
  type SignInStart,
} from "../lib/auth/sign-in-client";
import { publishIdentity } from "../lib/auth/identity-store";

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
      if (!active) return;
      setIdentity(resolved);
      // The ⌘K palette beside the nav offers what this role opens (public polish).
      publishIdentity(resolved);
    });
    return () => {
      active = false;
      controller.abort();
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
    }
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
      <button
        type="button"
        className="primary-nav-report"
        onClick={() => open(t("reportSeed"))}
        aria-label={t("reportAria")}
      >
        {t("report")}
      </button>
      {/* Everything a signed-in person can do beyond browsing — Admin, Add
          equipment, Sign out — lives in their profile menu, not the bar
          (Isaac, 2026-09-23). Refresh moved to `/admin`.
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
            className="primary-nav-report primary-nav-auth"
            onClick={handleSignIn}
            disabled={busy}
            aria-label={t("signInAria", { institution: siteConfig.institution })}
          >
            {t("signIn")}
          </button>
          {/* Development-only sign-in (auth spec amendment 2026-09-24). Shown
              only when `/api/identity` says every server-side guard passed for
              this request; the route checks them all again. A plain anchor,
              not a Link: it is a full navigation that sets a cookie. */}
          {identity?.devSignIn ? (
            <a
              className="primary-nav-report primary-nav-dev-sign-in"
              href={`${DEV_SIGN_IN_ENDPOINT}?next=${encodeURIComponent(pathname)}`}
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
