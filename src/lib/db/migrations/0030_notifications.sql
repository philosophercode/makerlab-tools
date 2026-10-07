-- Email notifications v1 (email notifications spec §4, approved 2026-10-07):
-- the outbox, one delivery row per recipient (its id is the provider's
-- idempotency key), and per-person preferences. No email address and no
-- rendered body is stored in any of the three; removing a person cascades.
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_notification_user_unique" UNIQUE("notification_id","user_id"),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("status" in ('pending', 'sending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "notification_deliveries_reason_check" CHECK ("reason" in ('pref_off', 'no_permission', 'subject_gone', 'preview_blocked', 'not_configured', 'invalid_recipient', 'rejected', 'stuck', 'provider_error'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suppressed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"audience_user_id" text,
	"dedupe_key" text NOT NULL,
	"surface" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"restarted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notifications_event_check" CHECK ("event" in ('ticket.filed', 'maintenance.due')),
	CONSTRAINT "notifications_status_check" CHECK ("status" in ('queued', 'fanned_out', 'done', 'skipped')),
	CONSTRAINT "notifications_surface_check" CHECK ("surface" in ('chat', 'mcp', 'gui', 'system')),
	CONSTRAINT "notifications_skip_reason_check" CHECK ("skip_reason" in ('capped', 'subject_gone'))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_audience_user_id_user_id_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_created_idx" ON "notification_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_created_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON "notifications" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON "notification_preferences" FOR EACH ROW EXECUTE FUNCTION set_updated_at();