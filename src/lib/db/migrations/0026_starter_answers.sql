-- Starter answers: the assistant's starter chips, asked ahead of time as an
-- anonymous visitor, graded, and kept so a chip answers at once. Served only
-- while `source_hash` matches the tool, its manuals and the pipeline
-- (`lib/starters/hash.ts`). Numbered after PR #121's 0025 and generated on top
-- of its snapshot: merge #121 first.
CREATE TABLE "starter_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid,
	"locale" text DEFAULT 'en' NOT NULL,
	"question" text NOT NULL,
	"message" jsonb NOT NULL,
	"model" text NOT NULL,
	"accepted" boolean NOT NULL,
	"grade" jsonb NOT NULL,
	"usage_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "starter_answers_chip_key" UNIQUE NULLS NOT DISTINCT("tool_id","locale","question")
);
--> statement-breakpoint
ALTER TABLE "starter_answers" ADD CONSTRAINT "starter_answers_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "starter_answers_tool_idx" ON "starter_answers" USING btree ("tool_id");