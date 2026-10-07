"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The short viewport: a phone on its side (or any window as short). There the
 * header is the short bar — one 48px row, the links behind MENU — and it
 * scrolls away with the page instead of sticking (DESIGN.md §8.12, amendment
 * "A phone on its side"). `globals.css` repeats this query for the short
 * bar's rules (CSS has no shared custom media); keep the two the same.
 */
export const SHORT_VIEWPORT_QUERY = "(orientation: landscape) and (max-height: 500px)";

/**
 * The header's MENU button and the links it shows on a short viewport.
 *
 * The WAI-ARIA disclosure pattern, not a `menu` role: the links stay links,
 * in document order after the button, so Tab walks them. It closes on Escape
 * (focus back to the button), on a press outside it, when focus moves to
 * anything else, and when the viewport stops being short — a phone turned
 * upright must not come back to a menu left open. Following a link closes it
 * too (the caller wires `close` to each one).
 */
export function useNavMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  const toggle = useCallback(() => setIsOpen((open) => !open), []);

  useEffect(() => {
    if (!isOpen) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      Boolean(toggleRef.current?.contains(target) || panelRef.current?.contains(target));

    function onPointerDown(event: MouseEvent) {
      if (!inside(event.target)) close(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    // Tab past the last link, ⌘K, the profile control: the menu should not
    // outlive the focus, and must not catch the next Escape meant for a dialog.
    function onFocusIn(event: FocusEvent) {
      if (!inside(event.target)) close(false);
    }
    const media = typeof window.matchMedia === "function" ? window.matchMedia(SHORT_VIEWPORT_QUERY) : null;
    function onMediaChange() {
      if (!media?.matches) close(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    media?.addEventListener("change", onMediaChange);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      media?.removeEventListener("change", onMediaChange);
    };
  }, [isOpen, close]);

  return { isOpen, toggle, close, toggleRef, panelRef };
}
