-- Many items at once (data platform spec amendment "Many items at once"): how
-- sure the chat's identification was about each item, and where it was seen.
-- Both are only ever written for the chat's rows; nullable, no backfill.
ALTER TABLE "pending_tools" ADD COLUMN "identify_confidence" text;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "seen_in" text;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_identify_confidence_check" CHECK ("identify_confidence" in ('sure', 'likely', 'unsure'));