CREATE TABLE "research_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"pending_tool_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "research_request_id" uuid;--> statement-breakpoint
ALTER TABLE "research_requests" ADD CONSTRAINT "research_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_requests" ADD CONSTRAINT "research_requests_pending_tool_id_pending_tools_id_fk" FOREIGN KEY ("pending_tool_id") REFERENCES "public"."pending_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_requests_user_idx" ON "research_requests" USING btree ("user_id","requested_at");