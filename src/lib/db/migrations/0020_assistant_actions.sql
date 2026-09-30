CREATE TABLE "action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"action_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"preview" jsonb NOT NULL,
	"surface" text NOT NULL,
	"chat_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"result" jsonb,
	"tainted" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposals_status_check" CHECK ("status" in ('open', 'confirming', 'confirmed', 'failed', 'conflict', 'cancelled')),
	CONSTRAINT "action_proposals_surface_check" CHECK ("surface" in ('assistant', 'mcp'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "surface" text DEFAULT 'gui' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposals" ADD CONSTRAINT "action_proposals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_proposals_creator_status_idx" ON "action_proposals" USING btree ("created_by","status");--> statement-breakpoint
CREATE INDEX "action_proposals_chat_idx" ON "action_proposals" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "action_proposals_group_idx" ON "action_proposals" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_surface_check" CHECK ("surface" in ('gui', 'assistant', 'mcp', 'system'));--> statement-breakpoint
-- Hand-added after drizzle-kit generate: `updated_at` is maintained by the
-- BEFORE UPDATE trigger every mutable table carries (migration 0002), which
-- drizzle-kit does not model. Assistant–GUI parity spec §3.5 and §3.7.
CREATE TRIGGER action_proposals_set_updated_at BEFORE UPDATE ON "action_proposals" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
