-- A photo for a name (data platform spec amendment "A photo for a name"): the
-- one candidate product photo looked up for an item the chat recorded from its
-- name alone — the lookup's state and, when found, the ranked picture and its
-- private cleaned copy (src/lib/intake/found-photo.ts). Nullable, no backfill.
ALTER TABLE "pending_tools" ADD COLUMN "found_photo" jsonb;
