import { eq, like, or } from "drizzle-orm";
import { resources, tools, units } from "../db/schema/index.ts";
import { slugify, uniqueSlug } from "../db/slug.ts";
import type { UnitCondition, UnitStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUniqueViolation } from "./pg-errors.ts";

/**
 * Creating a tool row, with its units and resources (spec §5.4 step 11, §4.4).
 *
 * The one place a `tools` row is inserted outside the import. Approval is its
 * caller today and `create_tool` over MCP will be, so the rules live here once:
 *
 * - **The slug is derived from the name once, here, and never again** (§4.4).
 *   It is the first free one in the `form-4`, `form-4-2`, … family. The unique
 *   index is the arbiter, not the read — two approvals of "Form 4" a moment
 *   apart both see `form-4` free — so the insert runs in a savepoint and a
 *   slug collision retries against the now-current family instead of aborting
 *   the caller's transaction.
 * - **`created_by` / `updated_by` are stamped on every row**, the tool, its
 *   units and its resources, with the person who approved it.
 * - **`published` has no default.** The caller says, every time, because
 *   Article 5 is exactly the question of who decided a tool is public.
 *
 * Takes its handle first and never opens its own top-level transaction: every
 * caller composes this with other writes (the photos, the pending row) that
 * must commit or roll back with it.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

export interface NewToolRecord {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  locationId?: string | null;
  materials?: string[];
  ppeRequired?: string[];
  tags?: string[];
  trainingRequired?: boolean;
  useRestrictions?: string | null;
  published: boolean;
  units?: {
    unitLabel: string;
    serialNumber?: string | null;
    status?: UnitStatus;
    condition?: UnitCondition | null;
  }[];
  resources?: { title: string; url: string; type: string }[];
}

export interface CreatedToolRecord {
  toolId: string;
  slug: string;
  /** In the order the units were given. */
  unitIds: string[];
  /** In the order the resources were given. */
  resourceIds: string[];
}

/** Attempts at a free slug before the collision is treated as a real failure. */
const SLUG_ATTEMPTS = 3;

export async function createToolRecord(
  db: Db,
  input: NewToolRecord,
  actorUserId: string | null
): Promise<CreatedToolRecord> {
  const name = input.name.trim();
  // The catalogue, the QR label and the chat all name a tool by this.
  if (!name) throw new Error("createToolRecord: a tool needs a name");

  const actor = { createdBy: actorUserId, updatedBy: actorUserId };
  const values = {
    name,
    description: emptyToNull(input.description),
    categoryId: input.categoryId ?? null,
    locationId: input.locationId ?? null,
    materials: cleanList(input.materials),
    ppeRequired: cleanList(input.ppeRequired),
    tags: cleanList(input.tags),
    trainingRequired: input.trainingRequired ?? false,
    useRestrictions: emptyToNull(input.useRestrictions),
    published: input.published,
    ...actor,
  };

  const created = await insertWithFreeSlug(db, slugify(name), values);

  const unitIds: string[] = [];
  if (input.units && input.units.length > 0) {
    const rows = await db
      .insert(units)
      .values(
        input.units.map((unit) => ({
          toolId: created.id,
          unitLabel: unit.unitLabel.trim(),
          serialNumber: emptyToNull(unit.serialNumber),
          status: unit.status ?? "available",
          condition: unit.condition ?? null,
          ...actor,
        }))
      )
      .returning({ id: units.id });
    unitIds.push(...rows.map((row) => row.id));
  }

  const resourceIds: string[] = [];
  if (input.resources && input.resources.length > 0) {
    const rows = await db
      .insert(resources)
      .values(
        input.resources.map((resource) => ({
          toolId: created.id,
          title: resource.title.trim(),
          url: resource.url,
          type: resource.type,
          ...actor,
        }))
      )
      .returning({ id: resources.id });
    resourceIds.push(...rows.map((row) => row.id));
  }

  return { toolId: created.id, slug: created.slug, unitIds, resourceIds };
}

/**
 * Insert the tool under the first free slug, retrying in a fresh savepoint when
 * somebody else took it between the read and the insert.
 */
async function insertWithFreeSlug(
  db: Db,
  base: string,
  values: Omit<typeof tools.$inferInsert, "slug">
): Promise<{ id: string; slug: string }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(async (savepoint) => {
        const slug = await allocateSlug(savepoint, base);
        const [row] = await savepoint
          .insert(tools)
          .values({ ...values, slug })
          .returning({ id: tools.id, slug: tools.slug });
        return row;
      });
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= SLUG_ATTEMPTS) throw err;
    }
  }
}

/** The first free slug in the `base`, `base-2`, `base-3`, … family. */
async function allocateSlug(db: Db, base: string): Promise<string> {
  const rows = await db
    .select({ slug: tools.slug })
    .from(tools)
    // Only the family, not the whole table (Article 4). `slugify` emits only
    // `[a-z0-9-]`, so the base carries no LIKE wildcards.
    .where(or(eq(tools.slug, base), like(tools.slug, `${base}-%`)));
  return uniqueSlug(base, new Set(rows.map((row) => row.slug)));
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

/** Trimmed, blanks dropped, order kept — these arrays are rendered as chips. */
function cleanList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}
