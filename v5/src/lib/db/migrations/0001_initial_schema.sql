CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"group" text,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_notion_page_id_unique" UNIQUE("notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room" text NOT NULL,
	"zone" text NOT NULL,
	"map_tag" text,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_map_tag_unique" UNIQUE("map_tag"),
	CONSTRAINT "locations_notion_page_id_unique" UNIQUE("notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"location_id" uuid,
	"materials" text[] DEFAULT '{}'::text[] NOT NULL,
	"ppe_required" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"training_required" boolean DEFAULT false NOT NULL,
	"use_restrictions" text,
	"emergency_stop" text,
	"notes" text,
	"published" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"last_reviewed_by" text,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tools_notion_page_id_unique" UNIQUE("notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid,
	"unit_label" text NOT NULL,
	"serial_number" text,
	"asset_tag" text,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text,
	"date_acquired" date,
	"notes" text,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_notion_page_id_unique" UNIQUE("notion_page_id"),
	CONSTRAINT "units_status_check" CHECK ("status" in ('available', 'in_use', 'under_maintenance', 'out_of_service', 'retired')),
	CONSTRAINT "units_condition_check" CHECK ("condition" in ('excellent', 'good', 'fair', 'needs_repair', 'new'))
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid,
	"title" text NOT NULL,
	"type" text,
	"url" text,
	"notes" text,
	"published" boolean DEFAULT true NOT NULL,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_notion_page_id_unique" UNIQUE("notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text,
	"owner_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"blob_pathname" text NOT NULL,
	"access" text NOT NULL,
	"public_url" text,
	"content_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"original_filename" text,
	"source_key" text,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "attachments_owner_type_check" CHECK ("owner_type" in ('tool', 'resource', 'maintenance_log', 'project', 'pending_tool')),
	CONSTRAINT "attachments_access_check" CHECK ("access" in ('public', 'private'))
);
--> statement-breakpoint
CREATE TABLE "maintenance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type" text,
	"priority" text,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text,
	"resolution" text,
	"unit_id" uuid,
	"tool_id" uuid,
	"tool_name" text,
	"unit_label" text,
	"reported_by_name" text,
	"reported_by_email" text,
	"reported_by_user_id" text,
	"assigned_to_user_id" text,
	"assigned_to_name" text,
	"date_reported" date,
	"date_resolved" date,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_logs_notion_page_id_unique" UNIQUE("notion_page_id"),
	CONSTRAINT "maintenance_logs_type_check" CHECK ("type" in ('issue_report', 'preventive_maintenance', 'repair', 'inspection', 'calibration')),
	CONSTRAINT "maintenance_logs_priority_check" CHECK ("priority" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "maintenance_logs_status_check" CHECK ("status" in ('open', 'in_progress', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid,
	"field_flagged" text,
	"issue_description" text NOT NULL,
	"suggested_fix" text,
	"reporter_name" text,
	"reporter_email" text,
	"reporter_user_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_notion_page_id_unique" UNIQUE("notion_page_id"),
	CONSTRAINT "feedback_field_flagged_check" CHECK ("field_flagged" in ('description', 'image', 'name', 'category', 'location', 'materials', 'safety_info')),
	CONSTRAINT "feedback_status_check" CHECK ("status" in ('new', 'reviewed', 'fixed', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "project_tools" (
	"project_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	CONSTRAINT "project_tools_project_id_tool_id_pk" PRIMARY KEY("project_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"materials" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_user_id" text,
	"author_name" text,
	"published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"notion_page_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "projects_notion_page_id_unique" UNIQUE("notion_page_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tools" ADD CONSTRAINT "project_tools_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tools" ADD CONSTRAINT "project_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_group_key" ON "categories" USING btree (lower("name"),lower(coalesce("group", '')));--> statement-breakpoint
CREATE UNIQUE INDEX "locations_room_zone_key" ON "locations" USING btree (lower("room"),lower("zone"));--> statement-breakpoint
CREATE INDEX "tools_name_trgm_idx" ON "tools" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tools_category_idx" ON "tools" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tools_location_idx" ON "tools" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "units_tool_idx" ON "units" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_tool_serial_key" ON "units" USING btree ("tool_id",lower("serial_number")) WHERE "units"."serial_number" is not null;--> statement-breakpoint
CREATE INDEX "resources_tool_idx" ON "resources" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("owner_type","owner_id","position");--> statement-breakpoint
CREATE INDEX "maintenance_logs_unit_idx" ON "maintenance_logs" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "maintenance_logs_tool_idx" ON "maintenance_logs" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "maintenance_logs_status_idx" ON "maintenance_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_tool_idx" ON "feedback" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_tools_tool_idx" ON "project_tools" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "projects_published_idx" ON "projects" USING btree ("published");--> statement-breakpoint
CREATE INDEX "audit_events_subject_idx" ON "audit_events" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");