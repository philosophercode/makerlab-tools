CREATE TABLE "bulk_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"format" text NOT NULL,
	"source_attachment_id" uuid,
	"source_name" text,
	"source_text" text NOT NULL,
	"column_map" jsonb,
	"status" text DEFAULT 'parsing' NOT NULL,
	"parse_error" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"workflow_run_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_imports_source_kind_check" CHECK ("source_kind" in ('csv', 'tsv', 'paste', 'document', 'chat')),
	CONSTRAINT "bulk_imports_format_check" CHECK ("format" in ('table', 'list', 'document')),
	CONSTRAINT "bulk_imports_status_check" CHECK ("status" in ('mapping', 'parsing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "research_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"extra_items" integer NOT NULL,
	"granted_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_owner_type_check";--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "serials" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "lab_docs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "name_suggestion" jsonb;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_source_attachment_id_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_allowances" ADD CONSTRAINT "research_allowances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_allowances" ADD CONSTRAINT "research_allowances_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_imports_created_idx" ON "bulk_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "research_allowances_user_idx" ON "research_allowances" USING btree ("user_id","expires_at");--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_import_id_bulk_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bulk_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_tools_import_idx" ON "pending_tools" USING btree ("import_id");--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_origin_check" CHECK ("origin" in ('lab_document'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_type_check" CHECK ("owner_type" in ('tool', 'resource', 'maintenance_log', 'project', 'pending_tool', 'bulk_import'));--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_quantity_check" CHECK ("pending_tools"."quantity" between 1 and 50);--> statement-breakpoint
-- Hand-appended, as in 0002, 0007, 0010 and 0012: updated_at is maintained by the
-- database, not the ORM (data platform spec §4). drizzle-kit does not generate
-- triggers. Bulk intake spec §4.1.
CREATE TRIGGER bulk_imports_set_updated_at BEFORE UPDATE ON "bulk_imports" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
