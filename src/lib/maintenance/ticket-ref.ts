/**
 * A ticket's short reference (quick report spec §5): the first eight hex
 * characters of its uuid, upper case. "3F2A9C1D" is what a student can read
 * off a phone and say at the front desk; staff find it on `/admin/maintenance`,
 * which shows it on each ticket and matches it in the search.
 *
 * Not unique by construction, the way a unit label's token is not (QR codes
 * spec §13): two tickets share one about once in four billion pairs. It
 * names a ticket to a person, never to a lookup. Pure; client-safe.
 */
export function ticketRef(id: string): string {
  return id.replace(/[^0-9a-f]/gi, "").slice(0, 8).toUpperCase();
}
