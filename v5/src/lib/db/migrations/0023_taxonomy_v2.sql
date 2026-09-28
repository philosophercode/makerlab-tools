-- Taxonomy v2 (docs/specs/2026-09-28-taxonomy-v2-design.md): a two-level
-- category tree with slugs, descriptions and retirement; category proposals
-- (nothing creates a category but accepting one, or taxonomy:migrate); and two
-- tool facets, item_kind and parent_tool_id. The tree itself and the moves are
-- data, written by `npm run taxonomy:migrate -- --apply`, not by this file.
CREATE TABLE "category_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'new_category' NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"description" text,
	"reason" text,
	"source" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"flag" text,
	"nearest_existing_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"resulting_category_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_proposals_kind_check" CHECK ("kind" in ('new_category', 'review_category')),
	CONSTRAINT "category_proposals_source_check" CHECK ("source" in ('research', 'refresh', 'chat', 'mcp', 'audit', 'gui')),
	CONSTRAINT "category_proposals_status_check" CHECK ("status" in ('pending', 'accepted', 'rejected', 'merged'))
);
--> statement-breakpoint
DROP INDEX "categories_name_group_key";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "gallery_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
CREATE OR REPLACE FUNCTION category_slug_base(name text, grp text) RETURNS text AS $$
  SELECT coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(grp || ' ', '') || coalesce(name, '')), '[^a-z0-9]+', '-', 'g')), ''),
    'category'
  )
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
UPDATE "categories" AS c SET "slug" = s.slug
FROM (
  SELECT id, base || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END AS slug
  FROM (
    SELECT id, category_slug_base("name", "group") AS base,
      row_number() OVER (PARTITION BY category_slug_base("name", "group") ORDER BY "created_at", id) AS rn
    FROM "categories"
  ) AS ranked
) AS s
WHERE c.id = s.id;--> statement-breakpoint
CREATE OR REPLACE FUNCTION categories_default_slug() RETURNS trigger AS $$
DECLARE
  base text;
  candidate text;
  n integer := 1;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := category_slug_base(NEW.name, NEW."group");
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM "categories" WHERE "slug" = candidate AND id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER categories_default_slug BEFORE INSERT OR UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION categories_default_slug();--> statement-breakpoint
CREATE TRIGGER category_proposals_set_updated_at BEFORE UPDATE ON "category_proposals" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "item_kind" text DEFAULT 'equipment' NOT NULL;--> statement-breakpoint
ALTER TABLE "tools" ADD COLUMN "parent_tool_id" uuid;--> statement-breakpoint
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_nearest_existing_id_categories_id_fk" FOREIGN KEY ("nearest_existing_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_resulting_category_id_categories_id_fk" FOREIGN KEY ("resulting_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_proposals_status_idx" ON "category_proposals" USING btree ("status");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_merged_into_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_parent_tool_id_fk" FOREIGN KEY ("parent_tool_id") REFERENCES "public"."tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_group_parent_key" ON "categories" USING btree (lower("name"),lower(coalesce("group", '')),coalesce("parent_id"::text, ''));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_item_kind_check" CHECK ("item_kind" in ('equipment', 'accessory', 'consumable', 'fixture'));