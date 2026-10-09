import { toCsv, type CsvValue } from "./csv.ts";

/**
 * The demo sign-ups CSV (demo pass spec 2026-10-07 §5.6): what a super admin
 * downloads from People → Demo sign-ups to follow up after a conference. One
 * row per sign-up, the answers as given, and whether the visitor may be
 * contacted — **only `May contact = yes` rows may be emailed about MakerLAB
 * AI** (§8). Formula-safe through `toCsv` (`csv.ts`): every cell here is text
 * a visitor typed.
 *
 * Pure: the read is done elsewhere and handed in. English headers and values,
 * like the tools CSV: it is a working file for staff, not a page.
 */

export interface DemoSignupCsvRecord {
  name: string;
  email: string;
  institution: string;
  role: string | null;
  runsMakerspace: boolean | null;
  useCase: string | null;
  consentToContact: boolean;
  passExpiresAt: Date;
  spentUsd: number;
  chargedTurns: number;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export const DEMO_SIGNUP_CSV_HEADERS = [
  "Signed up",
  "Name",
  "Email",
  "Institution",
  "Role",
  "Runs or works in a makerspace",
  "What they would use it for",
  "May contact",
  "Pass ends",
  "Spent (USD)",
  "Chat turns",
  "Last used",
] as const;

/** `staff_technician` → `staff technician`; the stored word, readable. */
function roleWords(role: string | null): string {
  return role ? role.replace(/_/g, " ") : "";
}

function yesNo(value: boolean | null): string {
  return value === null ? "" : value ? "yes" : "no";
}

function isoInstant(at: Date | null): string {
  return at ? new Date(at).toISOString() : "";
}

export function demoSignupsCsv(records: readonly DemoSignupCsvRecord[]): string {
  const rows: CsvValue[][] = records.map((record) => [
    isoInstant(record.createdAt),
    record.name,
    record.email,
    record.institution,
    roleWords(record.role),
    yesNo(record.runsMakerspace),
    record.useCase ?? "",
    record.consentToContact ? "yes" : "no",
    isoInstant(record.passExpiresAt),
    record.spentUsd.toFixed(4),
    record.chargedTurns,
    isoInstant(record.lastUsedAt),
  ]);
  return toCsv(DEMO_SIGNUP_CSV_HEADERS, rows);
}

/** `demo-signups-2026-10-11.csv` — the day it was downloaded. */
export function demoSignupsCsvFilename(now: Date = new Date()): string {
  return `demo-signups-${now.toISOString().slice(0, 10)}.csv`;
}
