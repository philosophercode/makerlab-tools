"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useChatLauncher } from "./ChatLauncherContext";
import { ASK_PARAM } from "../lib/kiosk/params";
import { isKioskPath } from "./kiosk-path";

/**
 * `?ask=1` opens the assistant on arrival — what the kiosk's QR code carries
 * (`/?src=kiosk&ask=1`, kiosk spec §5.4). Presentation only: the page and its
 * data are the same with or without it, and the chat that opens is the
 * ordinary anonymous one. Opens once per arrival, so closing the sheet keeps
 * it closed.
 *
 * Unlike a machine label's `?src=qr`, which only *surfaces* the assistant, a
 * kiosk scan opens it: the visitor pointed a phone at a sign that says "Ask
 * the assistant", and is not standing at one machine with specs to read.
 */
export function AskParamOpener() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { open } = useChatLauncher();
  const opened = useRef(false);
  const ask = searchParams?.get(ASK_PARAM) === "1" && !isKioskPath(pathname);

  useEffect(() => {
    if (!ask || opened.current) return;
    opened.current = true;
    open();
  }, [ask, open]);

  return null;
}
