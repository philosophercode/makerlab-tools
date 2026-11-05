-- Photo options (photo options spec 2026-10-29): an admin asks for candidate
-- cover pictures for a catalogue tool; a background search writes the ranked
-- pictures it found (URLs only) and the admin picks one. At most one search
-- running per tool.
CREATE TABLE "tool_photo_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"status" text DEFAULT 'searching' NOT NULL,
	"note" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"requested_by" text,
	"chosen_url" text,
	"chosen_by" text,
	"chosen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_photo_searches_status_check" CHECK ("status" in ('searching', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "tool_photo_searches" ADD CONSTRAINT "tool_photo_searches_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_photo_searches" ADD CONSTRAINT "tool_photo_searches_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_photo_searches" ADD CONSTRAINT "tool_photo_searches_chosen_by_user_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_photo_searches_one_running_idx" ON "tool_photo_searches" USING btree ("tool_id") WHERE "tool_photo_searches"."status" = 'searching';--> statement-breakpoint
CREATE INDEX "tool_photo_searches_tool_idx" ON "tool_photo_searches" USING btree ("tool_id","created_at");