-- Performance: a public image's pre-rendered thumbnails (src/lib/images/thumbnail-urls.ts).
-- Nullable, no backfill here: `npm run thumbnails:backfill` renders them for
-- existing rows, and pages fall back to next/image on the original until then.
ALTER TABLE "attachments" ADD COLUMN "thumbnails" jsonb;
