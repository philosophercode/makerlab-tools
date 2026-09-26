"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";
import { AdminLink } from "./AdminLink";
import { ProfileAvatar } from "./ProfileAvatar";
import { canAddEquipment } from "../lib/capabilities/access";
import { canReachAdmin } from "../lib/auth/permissions";
import {
  firstNameOf,
  signOutAndReload,
  type ClientIdentity,
} from "../lib/auth/sign-in-client";

/**
 * The signed-in person's control in the header: photo, first name, caret, and
 * a menu holding everything that used to crowd the nav bar (Isaac, 2026-09-23).
 *
 * The menu shows who you are (name, email, role), then only the entries this
 * identity can use: Admin for anyone holding an admin-surface permission
 * (`AdminLink`'s own rule), Add equipment for `tools.add`, and Sign out for
 * everyone. As with every header control, hiding an entry is presentation —
 * `/admin` and the chat's intake capability check again on the server.
 *
 * Keyboard and pointer behaviour follow the WAI-ARIA menu-button pattern:
 * Enter/Space/ArrowDown open on the first item, ArrowUp on the last; arrows,
 * Home and End move; Escape closes and returns focus to the button; Tab and a
 * click outside close without taking focus anywhere.
 */
export function ProfileMenu({ identity }: { identity: ClientIdentity }) {
  const t = useTranslations("nav");
  const tRoles = useTranslations("admin.roles");
  const { open: openChat } = useChatLauncher();

  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Which item to focus once the menu has rendered. A ref, not state: it is an
  // instruction to the effect below, not something the render shows.
  const pendingFocus = useRef<"first" | "last" | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const fullName = identity.name?.trim() || "";
  const firstName = firstNameOf(identity.name);
  const initial = (fullName || identity.email || "?").charAt(0).toUpperCase();
  const roleLabel =
    identity.role === "anonymous" ? null : tRoles(identity.role);

  const items = useCallback(
    () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
      ),
    []
  );

  const focusEdge = useCallback(
    (edge: "first" | "last") => {
      const list = items();
      (edge === "first" ? list[0] : list[list.length - 1])?.focus();
    },
    [items]
  );

  const close = useCallback((returnFocus: boolean) => {
    pendingFocus.current = null;
    setIsOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Move focus into the menu once it exists.
  useEffect(() => {
    if (!isOpen) return;
    const edge = pendingFocus.current;
    pendingFocus.current = null;
    if (edge) focusEdge(edge);
  }, [isOpen, focusEdge]);

  // A press anywhere outside the control closes the menu. Focus is left where
  // the person put it.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent | MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) close(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, close]);

  function openMenu(edge: "first" | "last") {
    if (isOpen) {
      focusEdge(edge);
      return;
    }
    pendingFocus.current = edge;
    setIsOpen(true);
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const list = items();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? list.length - 1 : index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        // Let focus leave naturally; the menu should not outlive it.
        close(false);
        break;
    }
  }

  function handleAdd() {
    // The chat sheet takes focus when it opens, so the button does not.
    close(false);
    openChat(t("addSeed"));
  }

  async function handleSignOut() {
    setBusy(true);
    await signOutAndReload();
  }

  return (
    <div className="profile-menu" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="primary-nav-profile"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={
          firstName ? t("signedInAria", { name: firstName }) : t("accountMenuLabel")
        }
        onClick={() => (isOpen ? close(false) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
      >
        <ProfileAvatar image={identity.image} initial={initial} />
        {firstName ? (
          <span className="primary-nav-profile-name">{firstName}</span>
        ) : null}
        <span className="primary-nav-profile-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className="profile-menu-panel" data-frosted="">
          <div className="profile-menu-header">
            <ProfileAvatar image={identity.image} initial={initial} size={40} />
            <div className="profile-menu-who">
              {fullName ? <p className="profile-menu-name">{fullName}</p> : null}
              {identity.email ? (
                <p className="profile-menu-email">{identity.email}</p>
              ) : null}
              {roleLabel ? <p className="profile-menu-role">{roleLabel}</p> : null}
            </div>
          </div>

          <ul
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={t("accountMenuLabel")}
            className="profile-menu-list"
            onKeyDown={onMenuKeyDown}
          >
            {canReachAdmin(identity) ? (
              <li role="none">
                <AdminLink
                  role={identity.role}
                  menuItem
                  className="profile-menu-item"
                  onClick={() => close(true)}
                />
              </li>
            ) : null}
            {canAddEquipment(identity) ? (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="profile-menu-item"
                  onClick={handleAdd}
                >
                  {t("addEquipment")}
                </button>
              </li>
            ) : null}
            {/* Everyone signed in may create a personal access token (MCP
                access spec §5.1). */}
            <li role="none">
              <Link
                href="/account/tokens"
                role="menuitem"
                tabIndex={-1}
                className="profile-menu-item"
                onClick={() => close(false)}
              >
                {t("connectAssistant")}
              </Link>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="profile-menu-item profile-menu-signout"
                onClick={handleSignOut}
                disabled={busy}
              >
                {t("signOut")}
              </button>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
