import { z } from "zod";
import { DEMO_SIGNUP_ROLES, type DemoSignupRole } from "../db/schema/vocabulary";

/**
 * The demo sign-up form's rules (demo pass spec 2026-10-07 §5.1, §8) — one
 * reading for the route that enforces them and the form that explains them.
 * Pure and client-safe.
 *
 * Every field is trimmed and capped; the role is a vocabulary; empty optional
 * answers become null. The honeypot (`website`) is a field a person never sees:
 * filled in, the submission is a bot's, and the route pretends to accept it.
 */

export const DEMO_SIGNUP_LIMITS = {
  name: 100,
  email: 254,
  institution: 150,
  useCase: 500,
} as const;

/** The fields a visitor fills in, as the form posts them. */
export const DEMO_SIGNUP_FIELDS = ["name", "email", "institution", "role", "runsMakerspace", "useCase", "consent"] as const;
export type DemoSignupField = (typeof DEMO_SIGNUP_FIELDS)[number];

/** Why a field was refused: the key of the form's message for it. */
export type DemoSignupFieldError = "required" | "tooLong" | "invalidEmail" | "invalid";

export interface DemoSignupInput {
  name: string;
  email: string;
  institution: string;
  role: DemoSignupRole | null;
  runsMakerspace: boolean | null;
  useCase: string | null;
  consentToContact: boolean;
}

/**
 * `bot` is a filled honeypot, decided before anything else is checked: a bot
 * learns nothing about the rules from the answer it gets.
 */
export type DemoSignupParse =
  | { kind: "valid"; value: DemoSignupInput }
  | { kind: "invalid"; fields: Partial<Record<DemoSignupField, DemoSignupFieldError>> }
  | { kind: "bot" };

const emailFormat = z.email();

/** Trimmed text with inner runs of whitespace (newlines included) collapsed to one space. */
function line(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Trimmed text that keeps its line breaks (the "what would you use it for" answer). */
function paragraph(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").trim() : "";
}

/** `"yes"` / `true` → true, `"no"` / `false` → false, anything else → null (not answered). */
function yesNo(value: unknown): boolean | null {
  if (value === true || value === "yes") return true;
  if (value === false || value === "no") return false;
  return null;
}

/** Lower-cased and trimmed — the form the unique key compares. */
export function normalizeDemoEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Parse and check a posted sign-up. Never throws. */
export function parseDemoSignup(body: unknown): DemoSignupParse {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (line(raw.website) !== "") return { kind: "bot" };
  const fields: Partial<Record<DemoSignupField, DemoSignupFieldError>> = {};

  const name = line(raw.name);
  if (!name) fields.name = "required";
  else if (name.length > DEMO_SIGNUP_LIMITS.name) fields.name = "tooLong";

  const email = normalizeDemoEmail(raw.email);
  if (!email) fields.email = "required";
  else if (email.length > DEMO_SIGNUP_LIMITS.email) fields.email = "tooLong";
  else if (!emailFormat.safeParse(email).success) fields.email = "invalidEmail";

  const institution = line(raw.institution);
  if (!institution) fields.institution = "required";
  else if (institution.length > DEMO_SIGNUP_LIMITS.institution) fields.institution = "tooLong";

  const roleText = line(raw.role);
  const role = roleText ? ((DEMO_SIGNUP_ROLES as readonly string[]).includes(roleText) ? (roleText as DemoSignupRole) : undefined) : null;
  if (role === undefined) fields.role = "invalid";

  const useCase = paragraph(raw.useCase);
  if (useCase.length > DEMO_SIGNUP_LIMITS.useCase) fields.useCase = "tooLong";

  if (raw.consent !== undefined && typeof raw.consent !== "boolean") fields.consent = "invalid";

  if (Object.keys(fields).length > 0) return { kind: "invalid", fields };

  return {
    kind: "valid",
    value: {
      name,
      email,
      institution,
      role: role ?? null,
      runsMakerspace: yesNo(raw.runsMakerspace),
      useCase: useCase || null,
      consentToContact: raw.consent === true,
    },
  };
}
