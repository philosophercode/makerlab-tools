"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";
import { ProfileSummary } from "./ProfileMenu";
import { canAddEquipment } from "../lib/capabilities/access";
import { signOutAndReload, type ClientIdentity } from "../lib/auth/sign-in-client";

/**
 * The account in the phone bar's MENU (DESIGN.md §8.12, amendment "The phone
 * bar"): who is signed in, then the profile menu's entries — Add equipment for
 * `tools.add`; Account, Connect AI assistant (MCP) and Sign out in crimson ink
 * for everyone. The phone bar has no room for the profile control, so its menu
 * moves into this one. Plain rows, not a `menu` role: MENU is a disclosure and
 * Tab walks it. `onNavigate` closes MENU when a row takes the visitor away.
 */
export function NavMenuAccount({ identity, onNavigate }: { identity: ClientIdentity; onNavigate: () => void }) {
  const t = useTranslations("nav");
  const { open: openChat } = useChatLauncher();
  const [busy, setBusy] = useState(false);

  function handleAdd() {
    // The chat sheet takes focus when it opens.
    onNavigate();
    openChat(t("addSeed"));
  }

  async function handleSignOut() {
    setBusy(true);
    await signOutAndReload();
  }

  return (
    <div className="primary-nav-menu-account">
      <ProfileSummary identity={identity} />
      {canAddEquipment(identity) ? (
        <button type="button" className="primary-nav-menu-row" onClick={handleAdd}>
          {t("addEquipment")}
        </button>
      ) : null}
      <Link href="/account" className="primary-nav-menu-row" onClick={onNavigate}>
        {t("account")}
      </Link>
      <Link href="/account/tokens" className="primary-nav-menu-row" onClick={onNavigate}>
        {t("connectAssistant")}
      </Link>
      <button
        type="button"
        className="primary-nav-menu-row primary-nav-menu-signout"
        onClick={handleSignOut}
        disabled={busy}
      >
        {t("signOut")}
      </button>
    </div>
  );
}
