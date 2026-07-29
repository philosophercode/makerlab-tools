"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";
import { RefreshCatalogButton } from "./RefreshCatalogButton";
import { siteConfig } from "../lib/site-config";
import {
  fetchIdentity,
  firstNameOf,
  isSignedIn,
  signOutAndReload,
  startGoogleSignIn,
  type ClientIdentity,
} from "../lib/auth/sign-in-client";

const LINKS = [
  { href: "/", key: "tools", match: (path: string) => path === "/" || path.startsWith("/tools") },
  { href: "/projects", key: "projects", match: (path: string) => path.startsWith("/projects") },
  { href: "/about", key: "about", match: (path: string) => path.startsWith("/about") },
] as const;

export function PrimaryNav() {
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
    // Come back to the page the user started on, never to "/" (spec §10).
    const started = await startGoogleSignIn(pathname);
    // On success the browser is already leaving for Google; this only matters
    // when sign-in is unconfigured or the request failed.
    if (!started) setBusy(false);
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
      <button
        type="button"
        className="primary-nav-add"
        onClick={() => open(t("addSeed"))}
        aria-label={t("addAria")}
      >
        {t("add")}
      </button>
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
        <button
          type="button"
          className="primary-nav-report primary-nav-auth"
          onClick={handleSignIn}
          disabled={busy}
          aria-label={t("signInAria", { institution: siteConfig.institution })}
        >
          {t("signIn")}
        </button>
      )}
    </nav>
  );
}
