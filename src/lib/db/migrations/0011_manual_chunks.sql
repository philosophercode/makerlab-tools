-- Manual text spec phase 2 (§4): passages for hybrid search. pgvector backs the
-- embedding column; Neon ships it, PGlite loads it at construction
-- (@electric-sql/pglite-pgvector, see src/lib/db/pglite.ts). Hand-prepended:
-- drizzle-kit does not generate CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "manual_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"tool_id" uuid,
	"ordinal" integer NOT NULL,
	"section_path" text[] DEFAULT '{}'::text[] NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"content" text NOT NULL,
	"search_text" text NOT NULL,
	"tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
	"embedding" vector(512)
);
--> statement-breakpoint
ALTER TABLE "manual_documents" ADD COLUMN "chunker_version" text;--> statement-breakpoint
ALTER TABLE "manual_chunks" ADD CONSTRAINT "manual_chunks_document_id_manual_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."manual_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_chunks_tsv_idx" ON "manual_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "manual_chunks_embedding_idx" ON "manual_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "manual_chunks_tool_idx" ON "manual_chunks" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "manual_chunks_document_idx" ON "manual_chunks" USING btree ("document_id","ordinal");