"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DemoPassView } from "../../lib/demo-pass/state";

/**
 * The visitor's demo pass, as the chat shows it (demo pass spec 2026-10-07
 * §5.3, §6): asked for once, the first time the chat opens, then kept current
 * by each turn's `data-demo-pass` part (the balance before the turn) and a
 * fresh ask after each turn that ran on a pass (the balance after it).
 *
 * The cookie is httpOnly, so the page cannot tell whether there is a pass
 * without asking; the route answers `{ active: false }` cheaply when there is
 * none. A failed ask leaves what was known — the indicator is a courtesy, and
 * the server decides what a turn may spend whatever it shows.
 */
export function useDemoPass(open: boolean) {
  const [pass, setPass] = useState<DemoPassView | null>(null);
  const asked = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/demo-pass", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { active?: boolean; pass?: DemoPassView };
      setPass(body?.active && body.pass ? body.pass : null);
    } catch {
      // Keep what was known.
    }
  }, []);

  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    void refresh();
  }, [open, refresh]);

  /** A turn's `data-demo-pass` part. */
  const fromStream = useCallback((data: unknown) => {
    if (isDemoPassView(data)) setPass(data);
  }, []);

  /** After a turn: ask again only when there is a pass to update. */
  const afterTurn = useCallback(() => {
    if (pass) void refresh();
  }, [pass, refresh]);

  return { pass, fromStream, afterTurn };
}

function isDemoPassView(value: unknown): value is DemoPassView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.remainingUsd === "number" && typeof v.budgetUsd === "number" && typeof v.exhausted === "boolean" && typeof v.expiresAt === "string";
}
