"use client";

import { useSharedIdentity } from "../../lib/auth/identity-store";
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
 */
export function HeaderSearch({ tools }: { tools: readonly PaletteTool[] }) {
  const identity = useSharedIdentity();
  const scope = usePaletteScope();
  const role = scope?.role ?? identity?.role ?? "anonymous";
  return <CommandPalette role={role} tools={scope ? scope.tools : tools} />;
}
