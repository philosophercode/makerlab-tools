CREATE TABLE "mirror_pages" (
	"mirror_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"notion_page_id" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_updated_at" timestamp with time zone,
	CONSTRAINT "mirror_pages_mirror_id_entity_entity_id_pk" PRIMARY KEY("mirror_id","entity","entity_id"),
	CONSTRAINT "mirror_pages_entity_check" CHECK ("entity" in ('categories', 'locations', 'tools', 'units', 'resources', 'maintenance', 'projects'))
);
--> statement-breakpoint
CREATE TABLE "notion_mirrors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"token_ciphertext" "bytea",
	"parent_page_id" text NOT NULL,
	"parent_page_title" text,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapping_generation" integer DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	"running_since" timestamp with time zone,
	"push_requested_at" timestamp with time zone,
	"sync_requested_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notion_mirrors_owner_user_id_unique" UNIQUE("owner_user_id"),
	CONSTRAINT "notion_mirrors_last_status_check" CHECK ("last_status" in ('ok', 'partial', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "mirror_pages" ADD CONSTRAINT "mirror_pages_mirror_id_notion_mirrors_id_fk" FOREIGN KEY ("mirror_id") REFERENCES "public"."notion_mirrors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_mirrors" ADD CONSTRAINT "notion_mirrors_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Hand-appended, as in 0002: updated_at is maintained by the database, not the
-- ORM (spec §4). drizzle-kit does not generate triggers.
CREATE TRIGGER notion_mirrors_set_updated_at BEFORE UPDATE ON "notion_mirrors" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
