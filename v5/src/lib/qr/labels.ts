import type { LabelContent } from "./label-layout.ts";
import { displayUrl, toolQrTargetUrl } from "./urls.ts";

/**
 * A tool's label content — what the admin sheets, the label script and the
 * tests all derive the same way. Pure; runs under plain Node for the script.
 */

export interface LabelTool {
  slug: string;
  name: string;
  /** Room. */
  room?: string | null;
  /** Zone within the room. */
  zone?: string | null;
}

/**
 * Room + zone as one human line. A tool with neither degrades to "" (the
 * label omits the line) rather than printing "undefined"; the same value in
 * both — Notion's sentinel for "no location" — is said once.
 */
export function formatLabelLocation(room?: string | null, zone?: string | null): string {
  const parts = [room, zone].map((part) => (part || "").trim()).filter((part) => part.length > 0);
  return Array.from(new Set(parts)).join(" / ");
}

export function labelContentFor(tool: LabelTool, origin: string): LabelContent {
  const url = toolQrTargetUrl(origin, tool.slug);
  return {
    name: (tool.name || "").trim(),
    location: formatLabelLocation(tool.room, tool.zone),
    url,
    shortUrl: displayUrl(url),
  };
}
