import type { CategoryOption } from "../data/taxonomy.ts";

/**
 * Research's category, resolved against the taxonomy that exists (taxonomy
 * v2 spec §4.3; data platform spec §3.7).
 *
 * **Taxonomy v2: by exact slug.** The prompt lists every live category as
 * `slug — Parent › Name: description` and research answers with one slug, so
 * matching is equality after trimming and lower-casing — no fuzzy guess. A
 * slug the lab does not have (misspelt, invented, retired) is no match:
 * `existingId` is null and the reviewer chooses. A wrong preselection is
 * worse than an empty one: the reviewer has to notice it to fix it.
 *
 * **Pre-v2 answers** (a stub, a stored row, a model that answered
 * `{ name, group }`) still match by name, as before: name and group both, or
 * the one category with that name when the group does not contradict it.
 *
 * Pure, and it creates nothing. Nothing in research creates a category;
 * approval records a proposal (`category_proposals`) instead.
 */

export interface ProposedCategory {
  name: string;
  group: string | null;
  /** Taxonomy v2: the slug research chose. */
  slug?: string;
}

export interface MatchedCategory {
  name: string;
  group: string | null;
  existingId: string | null;
  slug?: string;
}

/** Case, surrounding space and runs of space do not make two categories different. */
function key(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * `proposed` with `existingId` set when it names an existing category. A
 * match answers with the *stored* name, heading and slug, so the page shows
 * the taxonomy's words, not the model's.
 */
export function matchCategory(proposed: ProposedCategory | null, categories: readonly CategoryOption[]): MatchedCategory {
  const slug = key(proposed?.slug);
  if (slug) {
    const chosen = categories.find((category) => category.slug !== undefined && key(category.slug) === slug);
    if (!chosen) return { name: proposed?.name.trim() || slug, group: proposed?.group?.trim() || null, existingId: null, slug };
    return { name: chosen.name, group: chosen.group, existingId: chosen.id, slug: chosen.slug };
  }

  const name = proposed?.name.trim() ?? "";
  const group = proposed?.group?.trim() || null;
  if (!name) return { name: "", group, existingId: null };

  const sameName = categories.filter((category) => key(category.name) === key(name));
  const exact = sameName.find((category) => key(category.group) === key(group));
  const chosen = exact ?? (sameName.length === 1 && !groupNamesOther(group, sameName[0]) ? sameName[0] : null);

  if (!chosen) return { name, group, existingId: null };
  return { name: chosen.name, group: chosen.group, existingId: chosen.id, ...(chosen.slug ? { slug: chosen.slug } : {}) };
}

/**
 * The model said a group, and it is a *different* group from the one
 * candidate's. "Accessories" under "Laser" is not the "Accessories" the model
 * meant when it said "Printing" — unless the stored one has no group at all,
 * in which case the model's group is extra detail, not a contradiction.
 */
function groupNamesOther(group: string | null, candidate: CategoryOption): boolean {
  return group !== null && candidate.group !== null && key(group) !== key(candidate.group);
}
