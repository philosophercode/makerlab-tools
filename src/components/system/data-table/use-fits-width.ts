"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Does everything inside `node` fit its width? — `false` until measured.
 *
 * A table wider than its column scrolls sideways inside its own frame, never
 * the page (DESIGN.md §6, §8.3). But a header cannot stick to the page from
 * inside a scroll box — `position: sticky` binds to the nearest one, and its
 * `top` would push the header down into the rows. So `DataTable` starts every
 * page-length table in a scroll box (the first paint can never widen the
 * page), measures here, and opens the box up — sticky header and all — only
 * when the table fits. Opening a box whose content fits moves nothing.
 *
 * It measures before paint and again whenever the frame or its table resizes
 * (a narrower window, a column shown from the Columns menu, new rows).
 * `enabled: false` (or no layout, as in jsdom, where nothing has a width)
 * keeps the scroll box.
 */
export function useFitsWidth(node: HTMLElement | null, enabled: boolean): boolean {
  const [fits, setFits] = useState(false);

  useLayoutEffect(() => {
    if (!enabled || !node) return;
    const measure = () => setFits(node.clientWidth > 0 && node.scrollWidth <= node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const table = node.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [node, enabled]);

  return enabled && fits;
}
