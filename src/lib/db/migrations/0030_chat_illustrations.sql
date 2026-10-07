-- Chat illustrations (gateway spec amendment 2026-10-07): one row per
-- illustration a signed-in person asked the assistant for: the ledger the
-- per-person daily cap and the lab-wide daily budget count, and where the
-- private picture is. Its own table, never `attachments`, so nothing that
-- publishes an attachment can reach one. Generated on top of 0030's snapshot.
CREATE TABLE "chat_illustrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"model" text NOT NULL,
	"cost_usd" double precision NOT NULL,
	"blob_pathname" text,
	"content_type" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "chat_illustrations_kind_check" CHECK ("kind" in ('plan', 'concept')),
	CONSTRAINT "chat_illustrations_status_check" CHECK ("status" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "chat_illustrations" ADD CONSTRAINT "chat_illustrations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_illustrations_user_idx" ON "chat_illustrations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_illustrations_created_idx" ON "chat_illustrations" USING btree ("created_at");