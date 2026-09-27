ALTER TABLE "attachments" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_origin_check" CHECK ("origin" in ('upload', 'import', 'manual_archive', 'research_image', 'research_image_cleaned'));--> statement-breakpoint
-- Hand-appended, as in 0002 and 0007: drizzle-kit does not generate data
-- changes. Archived manuals already record their source in `source_key`
-- (`manual:<resource id>:<source url>`, src/lib/data/manual-archives.ts), so
-- they get `origin` and `source_url` now (gateway spec §4.2). Every other row
-- keeps both null: nothing recorded how it was stored.
UPDATE "attachments" SET "origin" = 'manual_archive', "source_url" = regexp_replace("source_key", '^manual:[0-9a-fA-F-]{36}:', '') WHERE "source_key" LIKE 'manual:%';
