-- Import progress (import progress spec 2026-10-27): a table's rows are
-- written in slices in the background, so an import gains the `identifying`
-- status and a `progress` record (total, done, the last row committed, a
-- document's parts read, the rows that made no item). Imports finished before
-- it keep `{}`. The rows of an import are read by `updated_at` as the page
-- polls, so the import index carries it.
ALTER TABLE "bulk_imports" DROP CONSTRAINT "bulk_imports_status_check";--> statement-breakpoint
DROP INDEX "pending_tools_import_idx";--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD COLUMN "progress" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "pending_tools_import_idx" ON "pending_tools" USING btree ("import_id","updated_at");--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_status_check" CHECK ("status" in ('mapping', 'parsing', 'identifying', 'ready', 'failed'));