import {
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { MirrorLastError, MirrorMapping } from "../../mirror/types.ts";
import { user } from "./auth.ts";
import { inListCheck, timestamps } from "./helpers.ts";
import { MIRROR_ENTITY, MIRROR_STATUS } from "./vocabulary.ts";

/**
 * The Notion mirror (spec §3.8, §4.12; migration `0007`).
 *
 * Relative imports with `.ts` extensions: the mirror's workflow steps load the
 * schema from an esbuild bundle under plain Node.
 */

/**
 * Whatever a driver hands back for a `bytea`, as a `Uint8Array`.
 *
 * PGlite returns a `Uint8Array`; the Neon (node-postgres) path a `Buffer`,
 * which is one already but is copied so callers never hold a view onto a
 * pooled buffer; and a driver that does not parse the type returns Postgres'
 * hex text form, `\x0a1b…`. Raw-SQL readers bypass `fromDriver`, so they call
 * this themselves.
 */
export function byteaToUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
      throw new TypeError("bytea: not a hex string");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new TypeError("bytea: unexpected driver value");
}

/**
 * A `bytea` column as a `Uint8Array`. Written as a `Buffer`, which is a
 * `Uint8Array` to PGlite and the one binary type every node-postgres version
 * serialises as bytea rather than as text.
 */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array | string }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
  fromDriver(value) {
    return byteaToUint8Array(value);
  },
});

/**
 * One mirror per admin who has set one up (§4.12).
 *
 * - `owner_user_id` is **unique and cascades**: a mirror is one person's, and
 *   deleting the person must delete their token with them.
 * - `token_ciphertext` is the Notion token under AES-256-GCM
 *   (`mirror/token-crypto.ts`). **Null means disconnected**: Disconnect forgets
 *   the token and keeps the mapping and `mirror_pages`, so reconnecting the
 *   same workspace updates the same pages instead of duplicating them. (§4.12
 *   typed it not null; the nullable column is what makes that possible.)
 * - `running_since` is the overlap guard; `push_requested_at` and
 *   `sync_requested_at` are the coalescing and Sync-now claims; `last_run_at`
 *   is when the last push finished, whatever its result, beside
 *   `last_synced_at`, which only moves when everything up to it was pushed.
 * - `last_error` is a {@link MirrorLastError}: a code the page translates and a
 *   scrubbed detail, never a token or an email.
 * - `mapping_generation` goes up by one whenever the mapping changes or an
 *   entity's pages are forgotten (`setMirrorMapping`, `resetMirrorEntities`).
 *   A push carries the generation it claimed under, and neither advances
 *   `last_synced_at` nor records a page once it has moved: that push was
 *   working from a mapping that is no longer true.
 *
 * The backup export nulls `token_ciphertext` (`cron/backup-policy.ts`).
 */
export const notionMirrors = pgTable(
  "notion_mirrors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenCiphertext: bytea("token_ciphertext"),
    parentPageId: text("parent_page_id").notNull(),
    parentPageTitle: text("parent_page_title"),
    mapping: jsonb("mapping").$type<MirrorMapping>().notNull().default({}),
    mappingGeneration: integer("mapping_generation").notNull().default(0),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    runningSince: timestamp("running_since", { withTimezone: true }),
    pushRequestedAt: timestamp("push_requested_at", { withTimezone: true }),
    syncRequestedAt: timestamp("sync_requested_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    lastError: jsonb("last_error").$type<MirrorLastError>(),
    ...timestamps(),
  },
  () => [inListCheck("notion_mirrors_last_status_check", "last_status", MIRROR_STATUS)]
);

/**
 * Which Notion page mirrors which app row (§4.12). Keyed on the mirror, the
 * entity and the row, so each mirror keeps its own pages and deleting a mirror
 * deletes its map.
 *
 * `source_updated_at` is the source row's `updated_at` as it was pushed,
 * written from the text the push selected so it keeps Postgres' microseconds.
 * No `updated_at` trigger: `pushed_at` is set by the push on every write.
 */
export const mirrorPages = pgTable(
  "mirror_pages",
  {
    mirrorId: uuid("mirror_id")
      .notNull()
      .references(() => notionMirrors.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    notionPageId: text("notion_page_id").notNull(),
    pushedAt: timestamp("pushed_at", { withTimezone: true }).notNull().defaultNow(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.mirrorId, t.entity, t.entityId] }),
    inListCheck("mirror_pages_entity_check", "entity", MIRROR_ENTITY),
  ]
);
