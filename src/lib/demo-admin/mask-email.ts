import type { Role } from "../auth/roles";
import { isDemoAdmin } from "./config";

/**
 * Email addresses as the demo identity sees them (demo admin spec 2026-10-11
 * §6): the first character, `***`, and the domain — `i***@cornell.edu`.
 *
 * Masked **on the server**, before a page hands rows to a client island, so a
 * real address never reaches a demo visitor's browser. Every admin surface
 * that renders somebody's address runs it through {@link emailFor}; for every
 * real role that is the address unchanged.
 */
export function maskEmail(email: string): string;
export function maskEmail(email: string | null | undefined): string | null;
export function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string" || email === "") return email ?? null;
  const at = email.lastIndexOf("@");
  // Not an address: show nothing of it rather than guess where it splits.
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

type Viewer = { role: Role | null | undefined } | null | undefined;

/** `email` as `viewer` may see it: masked for the demo identity, untouched otherwise. */
export function emailFor(viewer: Viewer, email: string): string;
export function emailFor(viewer: Viewer, email: string | null | undefined): string | null;
export function emailFor(viewer: Viewer, email: string | null | undefined): string | null {
  return isDemoAdmin(viewer) ? maskEmail(email) : (email ?? null);
}

/**
 * Every row's `key` masked for the demo identity — rows unchanged (the same
 * array) for anyone else, so a real viewer's page does no extra work.
 */
export function maskEmailsFor<T extends object, K extends keyof T>(viewer: Viewer, rows: T[], ...keys: K[]): T[] {
  if (!isDemoAdmin(viewer)) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const key of keys) {
      const value = copy[key];
      if (typeof value === "string" || value == null) copy[key] = maskEmail(value as string | null) as T[K];
    }
    return copy;
  });
}
