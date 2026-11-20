/**
 * A category's slug from its name (and, for a pre-v2 row, its group) — the
 * same rule as the `category_slug_base` SQL function in migration `0023`:
 * lower-case, every run of anything but `a-z0-9` becomes one `-`, no leading
 * or trailing `-`, and `category` when nothing is left.
 *
 * Pure, no imports: scripts load it under plain Node.
 */
export function categorySlug(name: string, group: string | null = null): string {
  const text = `${group ? `${group} ` : ""}${name}`.toLowerCase();
  const slug = text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "category";
}
