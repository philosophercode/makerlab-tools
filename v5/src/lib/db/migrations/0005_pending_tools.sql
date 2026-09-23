CREATE TABLE "pending_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" text DEFAULT 'identified' NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"category_hint" text,
	"location_hint" text,
	"serial_number" text,
	"duplicate_of_tool_id" uuid,
	"duplicate_of_pending_id" uuid,
	"duplicate_resolution" text,
	"research" jsonb,
	"research_error" text,
	"workflow_run_id" text,
	"research_requested_by" text,
	"research_requested_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_tool_id" uuid,
	"created_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_tools_status_check" CHECK ("status" in ('identified', 'queued', 'researching', 'researched', 'failed', 'approved', 'discarded')),
	CONSTRAINT "pending_tools_duplicate_resolution_check" CHECK ("duplicate_resolution" in ('new_tool', 'add_unit', 'discard'))
);
--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_duplicate_of_tool_id_tools_id_fk" FOREIGN KEY ("duplicate_of_tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_duplicate_of_pending_id_pending_tools_id_fk" FOREIGN KEY ("duplicate_of_pending_id") REFERENCES "public"."pending_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_research_requested_by_user_id_fk" FOREIGN KEY ("research_requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_created_tool_id_tools_id_fk" FOREIGN KEY ("created_tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_created_unit_id_units_id_fk" FOREIGN KEY ("created_unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_tools_status_idx" ON "pending_tools" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_tools_batch_idx" ON "pending_tools" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "pending_tools_requested_idx" ON "pending_tools" USING btree ("research_requested_by","research_requested_at");--> statement-breakpoint
CREATE INDEX "pending_tools_name_trgm_idx" ON "pending_tools" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
-- Hand-appended, as in 0002: updated_at is maintained by the database, not the
-- ORM (spec §4). drizzle-kit does not generate triggers.
CREATE TRIGGER pending_tools_set_updated_at BEFORE UPDATE ON "pending_tools" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
