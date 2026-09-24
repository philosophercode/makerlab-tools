CREATE TABLE "chat_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"proposal" jsonb NOT NULL,
	"base_revision" text NOT NULL,
	"chat_id" text,
	"created_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_proposals_subject_kind_check" CHECK ("subject_kind" in ('tool', 'pending'))
);
--> statement-breakpoint
CREATE TABLE "tool_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"request_id" uuid NOT NULL,
	"base_revision" text NOT NULL,
	"note" text,
	"include_description" boolean DEFAULT false NOT NULL,
	"research" jsonb,
	"proposals" jsonb,
	"research_error" text,
	"workflow_run_id" text,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_refreshes_status_check" CHECK ("status" in ('queued', 'researching', 'proposed', 'failed', 'decided'))
);
--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "floor_check" text;--> statement-breakpoint
ALTER TABLE "research_requests" ADD COLUMN "tool_refresh_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_proposals" ADD CONSTRAINT "chat_proposals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_proposals" ADD CONSTRAINT "chat_proposals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_refreshes" ADD CONSTRAINT "tool_refreshes_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_refreshes" ADD CONSTRAINT "tool_refreshes_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_refreshes" ADD CONSTRAINT "tool_refreshes_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_proposals_subject_idx" ON "chat_proposals" USING btree ("subject_kind","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_refreshes_one_open_idx" ON "tool_refreshes" USING btree ("tool_id") WHERE "tool_refreshes"."status" in ('queued', 'researching', 'proposed');--> statement-breakpoint
CREATE INDEX "tool_refreshes_status_idx" ON "tool_refreshes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_refreshes_tool_idx" ON "tool_refreshes" USING btree ("tool_id");--> statement-breakpoint
ALTER TABLE "research_requests" ADD CONSTRAINT "research_requests_tool_refresh_id_tool_refreshes_id_fk" FOREIGN KEY ("tool_refresh_id") REFERENCES "public"."tool_refreshes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-appended, as in 0002, 0007 and 0010: updated_at is maintained by the
-- database, not the ORM (data platform spec §4). drizzle-kit does not generate
-- triggers. Refresh research spec §4.1 and §12.2.
CREATE TRIGGER tool_refreshes_set_updated_at BEFORE UPDATE ON "tool_refreshes" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER chat_proposals_set_updated_at BEFORE UPDATE ON "chat_proposals" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
