-- Tool skills (tool skills spec 2026-10-07): every cited operating guide a
-- tool has had, versioned per tool, written by job skillWrite from the lab's
-- sources and checked by code. A tool's current skill is its latest ready row.
-- Generated on top of 0030's snapshot.
CREATE TABLE "tool_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"trigger" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_skills_tool_version_key" UNIQUE("tool_id","version"),
	CONSTRAINT "tool_skills_status_check" CHECK ("status" in ('ready', 'failed')),
	CONSTRAINT "tool_skills_trigger_check" CHECK ("trigger" in ('research', 'manual', 'backfill'))
);
--> statement-breakpoint
ALTER TABLE "tool_skills" ADD CONSTRAINT "tool_skills_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_skills_current_idx" ON "tool_skills" USING btree ("tool_id","status","version");--> statement-breakpoint
CREATE INDEX "tool_skills_created_idx" ON "tool_skills" USING btree ("created_at");