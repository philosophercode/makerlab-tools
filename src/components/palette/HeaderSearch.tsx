"use client";

import { useSharedIdentity } from "../../lib/auth/identity-store";
import { useChatLauncher } from "../ChatLauncherContext";
import { CommandPalette } from "./CommandPalette";
import { usePaletteScope } from "./palette-scope";
import type { PaletteTool } from "./palette-types";

/**
 * The header's search field and the ⌘K palette behind it, on every page
 * (public polish). Who is asking comes from the header's own identity answer
 * (`PrimaryNav` publishes it) — or, on an admin page, from the admin layout,
 * which resolved it on the server and also hands over the tool index with
 * drafts (`PaletteScope`). Anonymous until one of them has answered, so the
 * palette never offers a page that would refuse the viewer.
 *
 * The palette also opens the assistant (phase 5b, `onAsk`): what was typed
 * becomes the first message. The chat is for everybody, so this is on every
 * page; on admin pages, where the floating button is not drawn, it is one of
 * the two ways in (with the section bar's button).
 */
export function HeaderSearch({ tools }: { tools: readonly PaletteTool[] }) {
  const identity = useSharedIdentity();
  const scope = usePaletteScope();
  const { open } = useChatLauncher();
  const role = scope?.role ?? identity?.role ?? "anonymous";
  return <CommandPalette role={role} tools={scope ? scope.tools : tools} onAsk={(query) => open(query || undefined)} />;
}
