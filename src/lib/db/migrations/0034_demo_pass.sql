-- Demo pass (demo pass spec 2026-10-07): the sign-ups a visitor makes at
-- /demo, each holding a 14-day pass and its spend ledger; a `demo` flag on
-- maintenance tickets a pass files; and `demo` as a usage audience, so demo
-- traffic stays out of the lab's numbers. Existing tickets are not demo.
CREATE TABLE "demo_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"institution" text NOT NULL,
	"role" text,
	"runs_makerspace" boolean,
	"use_case" text,
	"consent_to_contact" boolean DEFAULT false NOT NULL,
	"pass_expires_at" timestamp with time zone NOT NULL,
	"spent_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"charged_turns" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_signups_role_check" CHECK ("role" in ('student', 'staff_technician', 'faculty', 'lab_manager', 'other')),
	CONSTRAINT "demo_signups_spent_check" CHECK ("demo_signups"."spent_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_audience_check";--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_signups_email_key" ON "demo_signups" USING btree ("email");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_audience_check" CHECK ("audience" in ('anonymous', 'member', 'staff', 'demo'));--> statement-breakpoint
CREATE TRIGGER demo_signups_set_updated_at BEFORE UPDATE ON "demo_signups" FOR EACH ROW EXECUTE FUNCTION set_updated_at();