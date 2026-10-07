-- Recurring maintenance v1 (recurring maintenance spec, amendment 2026-10-06):
-- staff-defined tasks per tool, per unit or for general lab upkeep, and the
-- log of each time one was checked off. Nothing here names a student.
CREATE TABLE "maintenance_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"done_on" date NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"done_by_user_id" text,
	"done_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid,
	"unit_id" uuid,
	"title" text NOT NULL,
	"instructions" text,
	"interval_count" integer NOT NULL,
	"interval_unit" text NOT NULL,
	"next_due_on" date NOT NULL,
	"last_done_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_schedules_interval_unit_check" CHECK ("interval_unit" in ('day', 'week', 'month')),
	CONSTRAINT "maintenance_schedules_status_check" CHECK ("status" in ('active', 'paused', 'archived')),
	CONSTRAINT "maintenance_schedules_interval_count_check" CHECK ("maintenance_schedules"."interval_count" between 1 and 730),
	CONSTRAINT "maintenance_schedules_unit_needs_tool_check" CHECK ("maintenance_schedules"."unit_id" is null or "maintenance_schedules"."tool_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "maintenance_completions" ADD CONSTRAINT "maintenance_completions_schedule_id_maintenance_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."maintenance_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_completions" ADD CONSTRAINT "maintenance_completions_done_by_user_id_user_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_completions_schedule_idx" ON "maintenance_completions" USING btree ("schedule_id","done_on");--> statement-breakpoint
CREATE INDEX "maintenance_schedules_status_due_idx" ON "maintenance_schedules" USING btree ("status","next_due_on");--> statement-breakpoint
CREATE INDEX "maintenance_schedules_tool_idx" ON "maintenance_schedules" USING btree ("tool_id");--> statement-breakpoint
CREATE TRIGGER maintenance_schedules_set_updated_at BEFORE UPDATE ON "maintenance_schedules" FOR EACH ROW EXECUTE FUNCTION set_updated_at();