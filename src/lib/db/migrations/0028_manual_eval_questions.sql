-- Eval questions from manuals (manual text spec amendment 2026-10-07): a few
-- questions per indexed manual, each answered on a known page, for the
-- retrieval and end-to-end manual evals. Eval data only; the app never reads it.
CREATE TABLE "manual_eval_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"tool_id" uuid,
	"question" text NOT NULL,
	"expected_pages" integer[] NOT NULL,
	"chunk_ordinal" integer NOT NULL,
	"section_path" text[] DEFAULT '{}'::text[] NOT NULL,
	"expected_answer" text NOT NULL,
	"source_hash" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_eval_questions" ADD CONSTRAINT "manual_eval_questions_document_id_manual_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."manual_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_eval_questions" ADD CONSTRAINT "manual_eval_questions_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_eval_questions_document_idx" ON "manual_eval_questions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "manual_eval_questions_tool_idx" ON "manual_eval_questions" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "manual_eval_questions_hash_idx" ON "manual_eval_questions" USING btree ("source_hash");