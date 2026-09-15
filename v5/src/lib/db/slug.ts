/**
 * URL slugs for tools and projects (spec §4.4, §4.13).
 *
 * A slug is derived from the name once, at creation, and kept across renames.
 * Collisions get a numeric suffix (`form-4`, `form-4-2`, `form-4-3`).
 */

const MAX_SLUG_LENGTH = 80;

/** `"Trotec Speedy 400, 80w"` → `"trotec-speedy-400-80w"`. Never empty. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Strip combining marks left by NFKD so "é" becomes "e".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "item";
}

/**
 * The first of `base`, `base-2`, `base-3`, … that is not in `taken`. Adds the
 * chosen slug to `taken` so a batch of inserts can share one set.
 */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
