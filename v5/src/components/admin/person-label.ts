/**
 * How an admin surface names a person whose account may have been removed
 * (auth spec amendment 2026-09-25, "Remove a person").
 *
 * The name itself is always a snapshot the row already holds — a ticket's
 * reporter, a project's author, whoever identified a pending item — so a
 * removal changes only the words around it: "<name> (removed)", or "Removed
 * user" when there is no name to show. A person still on the roster reads as
 * before.
 *
 * Directive-free on purpose: server pages pass `getTranslations("admin.people")`,
 * client islands `useTranslations("admin.people")`.
 */

type Translate = (key: "removedName" | "removedUser", values?: Record<string, string>) => string;

export function personLabel(t: Translate, name: string | null | undefined, removed: boolean | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!removed) return trimmed;
  return trimmed ? t("removedName", { name: trimmed }) : t("removedUser");
}
