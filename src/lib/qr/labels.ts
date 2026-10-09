import type { LabelContent } from "./label-layout.ts";
import { displayUrl, toolQrTargetUrl, unitQrTargetUrl } from "./urls.ts";

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
  /**
   * One physical unit of the tool, for a unit's own label (QR codes spec
   * amendment 2026-10-06): the code names the unit and the label says which
   * one. Absent for the tool's label.
   */
  unit?: { id: string; name: string } | null;
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

/**
 * The unit line under the tool's name. A unit named exactly like its tool
 * (a lab with one Trotec calls the unit "Trotec Speedy 400") says nothing the
 * name does not, so it is left off rather than printed twice.
 */
export function unitLabelLine(toolName: string, unitName?: string | null): string {
  const unit = (unitName || "").trim();
  if (!unit) return "";
  return unit.toLowerCase() === (toolName || "").trim().toLowerCase() ? "" : unit;
}

export function labelContentFor(tool: LabelTool, origin: string): LabelContent {
  const url = tool.unit ? unitQrTargetUrl(origin, tool.slug, tool.unit.id) : toolQrTargetUrl(origin, tool.slug);
  const name = (tool.name || "").trim();
  return {
    name,
    ...(tool.unit ? { unit: unitLabelLine(name, tool.unit.name) } : {}),
    location: formatLabelLocation(tool.room, tool.zone),
    url,
    shortUrl: displayUrl(url),
  };
}
