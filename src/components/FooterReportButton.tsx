"use client";

import { useChatLauncher } from "./ChatLauncherContext";

/**
 * The footer's "Report a problem" (identity spec amendment "ADMIN in the bar",
 * 2026-10-07): what the header's REPORT did before it left the bar — open the
 * assistant and send "I'd like to report a problem." for the person, so it
 * asks which machine and files the ticket. On a tool page the hero's own
 * Report a problem opens the quick report form for that machine instead.
 *
 * The footer is a server component, so the words arrive translated as props
 * and no message namespace has to reach the browser for them.
 */
export function FooterReportButton({ label, seed }: { label: string; seed: string }) {
  const { open } = useChatLauncher();
  return (
    <button type="button" className="cursor-pointer uppercase hover:text-foreground" onClick={() => open(seed)}>
      {label}
    </button>
  );
}
