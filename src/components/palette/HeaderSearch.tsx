"use client";

import { useMemo } from "react";
import { useSharedIdentity } from "../../lib/auth/identity-store";
import { useChatLauncher } from "../ChatLauncherContext";
import { CommandPalette } from "./CommandPalette";
import { usePaletteScope } from "./palette-scope";
import type { PaletteTool } from "./palette-types";

/**
 * The header's search field and the ⌘K palette behind it, on every page
 * (public polish). Who is asking comes from the header's own identity answer
 * (`PrimaryNav` publishes it) — or, on an admin page, from the admin layout,
 * which resolved it on the server and also hands over the drafts the viewer
 * may open (`PaletteScope`), added to the published list. Anonymous until one of them has answered, so the
 * palette never offers a page that would refuse the viewer.
 *
 * The palette also opens MakerLAB AI (phase 5b, `onAsk`): what was typed
 * becomes the first message and is **sent at once** — the person wrote it and
 * chose "Ask MakerLAB AI: “…”". Every other entry point (Report, Add
 * equipment, the QR notice) only pre-fills the composer. The chat is for everybody, so this is on every
 * page; on admin pages, where the floating button is not drawn, it is one of
 * the two ways in (with the section bar's button).
 */
export function HeaderSearch({ tools }: { tools: readonly PaletteTool[] }) {
  const identity = useSharedIdentity();
  const scope = usePaletteScope();
  const { open } = useChatLauncher();
  const role = scope?.role ?? identity?.role ?? "anonymous";
  const drafts = scope?.drafts;
  const all = useMemo(() => (drafts && drafts.length > 0 ? [...tools, ...drafts] : tools), [tools, drafts]);
  return <CommandPalette role={role} tools={all} onAsk={(query) => open(query || undefined, { send: true })} />;
}
