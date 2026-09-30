"use client";

import { useEffect } from "react";
import { useChatLauncher } from "./ChatLauncherContext";

/**
 * Tells the assistant launcher that this page's record may be curated by the
 * viewer (refresh research spec §12.3), so `ChatFab` offers a "Curate this
 * entry" chip. Rendered only for someone who may: by `EditToolControl` on a
 * tool's page once `/api/identity` says `tools.edit`, and by the preliminary
 * page for a `tools.approve` holder. Hiding the chip is presentation; the chat
 * route composes curation only for a caller who holds the permission.
 */
export function CurateChatStarter({ keys }: { keys: readonly string[] }) {
  const { setCurate } = useChatLauncher();
  const joined = keys.join("\n");

  useEffect(() => {
    setCurate({ keys: joined.split("\n").filter(Boolean) });
    return () => setCurate(null);
  }, [joined, setCurate]);

  return null;
}
