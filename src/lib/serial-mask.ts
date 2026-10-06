/**
 * What students and visitors see of a unit's serial (data platform spec
 * amendment 2026-10-06): its **last four characters behind a mask**,
 * `•••• 9831`, so a student can tell staff "the one ending 9831" while the
 * serial stays fairly anonymous. A serial of four characters or fewer is not
 * shown at all: its last four would be all of it. Staff see the whole serial
 * instead (`catalog.view_serials`, `lib/unit-serials.ts`).
 *
 * The one format, everywhere: the catalogue reads store it on each unit as
 * `serialMasked`, and the units table, the assistant's focused-tool prompt,
 * `get_unit_details` and `get_tool_details` (chat and MCP) show that string as
 * it is. Screen readers hear "Serial ending 9831" (`detail.serialEnding`).
 *
 * Pure and dependency-free, so the units table (a client component) can use it.
 */

/** The mask shown in place of every character but the last four. */
export const SERIAL_MASK = "••••";

/** How many characters of a serial a student sees. */
export const SERIAL_SHOWN = 4;

/**
 * `•••• 9831` for a serial longer than four characters (surrounding spaces
 * ignored), else undefined: a short serial, or none at all, shows nothing.
 */
export function maskSerial(serial: string | null | undefined): string | undefined {
  const chars = Array.from((serial ?? "").trim());
  if (chars.length <= SERIAL_SHOWN) return undefined;
  return `${SERIAL_MASK} ${chars.slice(-SERIAL_SHOWN).join("")}`;
}

/** The characters a masked serial shows: "9831" from `•••• 9831`, for "Serial ending 9831". */
export function maskedSerialEnding(masked: string): string {
  return Array.from(masked).slice(-SERIAL_SHOWN).join("");
}
