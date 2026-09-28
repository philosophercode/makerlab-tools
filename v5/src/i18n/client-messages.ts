import type { Messages } from "./messages";

/**
 * Which translations reach the browser, per layout (performance plan, quick
 * win 6). Server components read every string through `getTranslations`; only
 * client components need messages serialized into the page, and before this
 * the root provider sent all of them — about 99 KB, 61 KB of it admin strings
 * — to every visitor, on every page and every admin poll.
 *
 * - **Public** (the root layout): the namespaces client components on public
 *   pages use, plus the admin strings public pages show a signed-in staff
 *   member: the header and palette, the chat's cards, and the tool page's
 *   editor panel.
 * - **Admin** (`app/admin/layout.tsx`) adds the `admin` namespace.
 * - **Account** (`app/account`, `app/oauth`, `app/mcp` layouts) adds
 *   `account`.
 *
 * A nested scope adds to the one above it (`MessagesScope`), leaving out what
 * the public set already sent. A client component that starts using a new
 * namespace needs it listed here: `client-messages.test.ts` follows the
 * imports from every route file to each client component, reads its
 * `useTranslations` calls, and fails on a key a route that renders it does
 * not send.
 */

/** Dotted paths: a whole namespace ("chat") or one subtree or key ("admin.nav"). */
export const PUBLIC_CLIENT_MESSAGES = [
  "nav",
  "status",
  "ui",
  "gallery",
  "detail",
  "chat",
  "flag",
  "palette",
  "errors",
  "qr",
  "catalogRefresh",
  "projectForm",
  "mcpPage",
  // The floor map (`/map`) and the tool page's location map (#98).
  "map",
  // The chat's cards, drawn on any page the chat opens on.
  "intake",
  "actions",
  "admin.errors",
  "admin.warnings",
  "admin.mirror.errors",
  // The chat's proposal cards (ProposalCard).
  "admin.proposal",
  // The ⌘K palette's admin surfaces and the profile menu's titles, for staff.
  "admin.nav",
  "admin.titles",
  // The tool page's Edit control and the editor panel it opens, and the
  // "Saving…" / "Saved" of `RowStatus`, which public components share.
  "admin.inventory.editor",
  "admin.saving",
  "admin.saved",
] as const;

export const ADMIN_CLIENT_MESSAGES = ["admin"] as const;

export const ACCOUNT_CLIENT_MESSAGES = ["account"] as const;

export type ClientMessagesScope = "admin" | "account";

const SCOPES: Record<ClientMessagesScope, readonly string[]> = {
  admin: ADMIN_CLIENT_MESSAGES,
  account: ACCOUNT_CLIENT_MESSAGES,
};

function isNamespace(value: unknown): value is Messages {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parts of `messages` named by `paths`, in the same shape. A path that
 * names nothing is skipped. The picked values are the originals, not copies,
 * so a subtree sent by two providers is the same object.
 */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const picked: Messages = {};
  for (const path of paths) {
    const keys = path.split(".");
    let source: Messages | string | undefined = messages;
    for (const key of keys) source = isNamespace(source) ? source[key] : undefined;
    if (source === undefined) continue;
    let target = picked;
    keys.slice(0, -1).forEach((key) => {
      const next = target[key];
      target = (target[key] = isNamespace(next) ? next : {}) as Messages;
    });
    target[keys[keys.length - 1]] = source;
  }
  return picked;
}

/** What the root layout's provider sends. */
export function publicClientMessages(messages: Messages): Messages {
  return pickMessages(messages, PUBLIC_CLIENT_MESSAGES);
}

/**
 * What a nested scope adds on top of the public set — without what the public
 * set already sent, which `MessagesScope` merges back in, so a string never
 * crosses the wire twice on one page.
 */
export function scopedClientMessages(messages: Messages, scope: ClientMessagesScope): Messages {
  return omitMessages(pickMessages(messages, SCOPES[scope]), PUBLIC_CLIENT_MESSAGES);
}

/** `messages` without the parts `paths` name, copied where it changes — never mutated. */
export function omitMessages(messages: Messages, paths: readonly string[]): Messages {
  let out = messages;
  for (const path of paths) out = omitPath(out, path.split("."));
  return out;
}

function omitPath(messages: Messages, keys: string[]): Messages {
  const [head, ...rest] = keys;
  if (!(head in messages)) return messages;
  const copy: Messages = { ...messages };
  if (rest.length === 0) {
    delete copy[head];
    return copy;
  }
  const child = messages[head];
  if (!isNamespace(child)) return messages;
  const trimmed = omitPath(child, rest);
  if (Object.keys(trimmed).length === 0) delete copy[head];
  else copy[head] = trimmed;
  return copy;
}

/** Two picks laid together, the second winning — what a nested scope's components see. */
export function mergeClientMessages(parent: Messages, child: Messages): Messages {
  const merged: Messages = { ...parent };
  for (const [key, value] of Object.entries(child)) {
    const base = merged[key];
    merged[key] = isNamespace(value) && isNamespace(base) ? mergeClientMessages(base, value) : value;
  }
  return merged;
}
