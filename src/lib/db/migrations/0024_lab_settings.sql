-- Lab settings (usage insight spec amendment "Value report"): one JSON value per
-- key, set per deployment through the action layer. The first key is
-- `value_report`, the value report's assumptions; nothing here names a student.
CREATE TABLE "lab_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_settings" ADD CONSTRAINT "lab_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;