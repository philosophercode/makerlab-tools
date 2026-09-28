-- Usage insight (docs/specs/2026-09-27-usage-insight-design.md): anonymous usage events
-- (30 days), hourly rollups (kept), and the Unanswered queue (30 days after last asked).
-- No column names a person. No backfill: counting starts on the deploy day.
CREATE TABLE "usage_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"surface" text NOT NULL,
	"audience" text NOT NULL,
	"tool_id" uuid,
	"manual_document_id" uuid,
	"page" integer,
	"source" text,
	"question_kind" text,
	"locale" text,
	"gap_id" uuid,
	CONSTRAINT "usage_events_kind_check" CHECK ("kind" in ('tool_view', 'kiosk_view', 'chat_turn', 'tool_asked', 'manual_cited', 'gap', 'mcp_call')),
	CONSTRAINT "usage_events_surface_check" CHECK ("surface" in ('web', 'chat', 'mcp')),
	CONSTRAINT "usage_events_audience_check" CHECK ("audience" in ('anonymous', 'member', 'staff')),
	CONSTRAINT "usage_events_question_kind_check" CHECK ("question_kind" in ('operate', 'debug', 'create', 'other'))
);
--> statement-breakpoint
CREATE TABLE "usage_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"tool_id" uuid,
	"question" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"dismissed_at_occurrences" integer,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"feedback_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "usage_gaps_key_unique" UNIQUE("key"),
	CONSTRAINT "usage_gaps_kind_check" CHECK ("kind" in ('not_in_catalog', 'no_manual_passage', 'no_search_results', 'honest_absence')),
	CONSTRAINT "usage_gaps_status_check" CHECK ("status" in ('open', 'dismissed', 'filed'))
);
--> statement-breakpoint
CREATE TABLE "usage_rollups" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_rollups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"hour_start" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"surface" text NOT NULL,
	"audience" text NOT NULL,
	"tool_id" uuid,
	"manual_document_id" uuid,
	"page" integer,
	"source" text,
	"question_kind" text,
	"count" integer NOT NULL,
	CONSTRAINT "usage_rollups_key" UNIQUE NULLS NOT DISTINCT("hour_start","kind","surface","audience","tool_id","manual_document_id","page","source","question_kind")
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_manual_document_id_manual_documents_id_fk" FOREIGN KEY ("manual_document_id") REFERENCES "public"."manual_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_gap_id_usage_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."usage_gaps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_gaps" ADD CONSTRAINT "usage_gaps_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_gaps" ADD CONSTRAINT "usage_gaps_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_gaps" ADD CONSTRAINT "usage_gaps_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_occurred_at_idx" ON "usage_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_tool_idx" ON "usage_events" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "usage_gaps_status_idx" ON "usage_gaps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_gaps_last_seen_idx" ON "usage_gaps" USING btree ("last_seen");--> statement-breakpoint
CREATE INDEX "usage_rollups_hour_idx" ON "usage_rollups" USING btree ("hour_start");