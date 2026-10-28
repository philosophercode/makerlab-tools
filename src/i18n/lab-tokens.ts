import enJson from "../../messages/en.json";
import { allowedEmailDomain } from "../lib/auth/roles.ts";
import { lab } from "../lib/lab/config.ts";
import { siteConfig } from "../lib/site-config.ts";
import type { Messages } from "./messages.ts";

/**
 * Lab tokens in messages (lab config spec amendment §12.2). Where a message
 * names the lab, it says `{labName}`, `{assistantName}`, `{siteName}`,
 * `{institution}` or `{emailDomain}` instead, and the tokens are filled here
 * **once, when the messages load**, from the lab config (with its env
 * overrides, through `siteConfig`). No `t()` call passes them, and client
 * components receive filled strings.
 *
 * `{institution}` was already an argument a few call sites pass with
 * `siteConfig.institution`; filled here first, it reads the same, and those
 * arguments are now unused.
 *
 * Every module that reads a message file goes through {@link withLabTokens}:
 * `request.ts`, `kiosk-locale.ts`, and {@link ENGLISH} below. A test fails on a file outside
 * them (and tests) that imports `messages/*.json`.
 */
export function labTokenValues(): Readonly<Record<LabToken, string>> {
  return {
    labName: lab.identity.labName,
    assistantName: siteConfig.chatAssistantName,
    siteName: siteConfig.name,
    institution: siteConfig.institution,
    emailDomain: allowedEmailDomain(),
  };
}

export const LAB_TOKENS = ["labName", "assistantName", "siteName", "institution", "emailDomain"] as const;
export type LabToken = (typeof LAB_TOKENS)[number];

const TOKEN = new RegExp(`\\{(${LAB_TOKENS.join("|")})\\}`, "g");

/**
 * A value as ICU message text: an apostrophe doubled, and the characters ICU
 * and next-intl's rich text treat as syntax quoted, so a lab named
 * `Kids' {Lab}` renders as written instead of breaking the message.
 */
export function escapeIcu(value: string): string {
  return value.replace(/'/g, "''").replace(/[{}<>]/g, (char) => `'${char}'`);
}

/** `messages` with every lab token filled. Pure: returns a new tree. */
export function withLabTokens<T extends Messages>(messages: T, values: Readonly<Record<LabToken, string>> = labTokenValues()): T {
  const escaped = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escapeIcu(value)]));
  const fill = (node: string | Messages): string | Messages => {
    if (typeof node === "string") return node.replace(TOKEN, (_, name: string) => escaped[name]);
    const out: Messages = {};
    for (const [key, child] of Object.entries(node)) out[key] = fill(child);
    return out;
  };
  return fill(messages) as T;
}

/** The English catalog, tokens filled: what server code reads English words from. */
export const ENGLISH: typeof enJson = withLabTokens(enJson as Messages) as unknown as typeof enJson;
