"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Is this element narrower than `breakpoint` pixels? — `true`, `false`, or
 * `null` when it cannot be measured (not mounted yet, or a runtime with no
 * layout, such as jsdom, where every width is 0).
 *
 * The container twin of `usePhoneLayout`, for a table that lives in a panel
 * whose width is not the viewport's: the chat's intake table is 360–440px
 * wide on a 1440px desktop. It measures before paint (`useLayoutEffect`) and
 * again whenever the element resizes, so the first frame is already the
 * right layout.
 */
export function useContainerNarrow(ref: RefObject<HTMLElement | null>, breakpoint: number, enabled: boolean): boolean | null {
  const [narrow, setNarrow] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    const measure = (width: number) => setNarrow(width > 0 ? width < breakpoint : null);
    measure(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, breakpoint, enabled]);

  return enabled ? narrow : null;
}
