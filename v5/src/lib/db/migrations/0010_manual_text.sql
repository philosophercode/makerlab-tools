CREATE TABLE "manual_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attachment_id" uuid NOT NULL,
	"tool_id" uuid,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"page_count" integer,
	"outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outline_source" text,
	"extractor_version" text NOT NULL,
	"embedding_model" text,
	"processed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_documents_attachment_id_unique" UNIQUE("attachment_id"),
	CONSTRAINT "manual_documents_status_check" CHECK ("status" in ('ready', 'no_text', 'failed')),
	CONSTRAINT "manual_documents_outline_source_check" CHECK ("outline_source" in ('pdf', 'inferred', 'none'))
);
--> statement-breakpoint
CREATE TABLE "manual_pages" (
	"document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"page_label" text,
	"text" text NOT NULL,
	CONSTRAINT "manual_pages_document_id_page_number_pk" PRIMARY KEY("document_id","page_number")
);
--> statement-breakpoint
ALTER TABLE "manual_documents" ADD CONSTRAINT "manual_documents_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_documents" ADD CONSTRAINT "manual_documents_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_pages" ADD CONSTRAINT "manual_pages_document_id_manual_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."manual_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_documents_tool_idx" ON "manual_documents" USING btree ("tool_id");--> statement-breakpoint
-- Hand-appended, as in 0002 and 0007: updated_at is maintained by the database,
-- not the ORM (spec §4). drizzle-kit does not generate triggers. Phase 1 of the
-- manual text spec: no `vector` extension and no `manual_chunks` yet.
CREATE TRIGGER manual_documents_set_updated_at BEFORE UPDATE ON "manual_documents" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
