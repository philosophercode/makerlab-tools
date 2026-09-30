CREATE TABLE "blocked_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text,
	"blocked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulk_imports" DROP CONSTRAINT "bulk_imports_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pending_tools" DROP CONSTRAINT "pending_tools_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "bulk_imports" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_tools" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "chat_proposals" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "blocked_emails" ADD CONSTRAINT "blocked_emails_blocked_by_user_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tools" ADD CONSTRAINT "pending_tools_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Remove replaces Ban (auth spec amendment 2026-09-25). Data, not shape, from
-- here down. First the audit actor's name, for every event already written,
-- before any account below is deleted and its foreign key clears.
UPDATE "audit_events" AS e SET "actor_name" = u."name" FROM "user" AS u WHERE u."id" = e."actor_user_id" AND e."actor_name" IS NULL;
--> statement-breakpoint
-- Every banned account becomes what the owner described: its address blocked,
-- the account removed, the history kept. The same steps as `removeUserAccount`
-- (src/lib/data/user-removal.ts), with a null actor.
INSERT INTO "blocked_emails" ("email", "reason", "blocked_by")
  SELECT lower(trim(u."email")), coalesce(nullif(trim(u."ban_reason"), ''), 'Banned before Remove replaced Ban'), NULL
    FROM "user" AS u WHERE u."banned" IS TRUE
  ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
UPDATE "pending_tools" AS p SET "created_by_name" = u."name" FROM "user" AS u WHERE u."id" = p."created_by" AND u."banned" IS TRUE;
--> statement-breakpoint
UPDATE "bulk_imports" AS b SET "created_by_name" = u."name" FROM "user" AS u WHERE u."id" = b."created_by" AND u."banned" IS TRUE;
--> statement-breakpoint
UPDATE "chat_proposals" AS c SET "created_by_name" = u."name" FROM "user" AS u WHERE u."id" = c."created_by" AND u."banned" IS TRUE;
--> statement-breakpoint
-- Touched so the Notion mirror re-pushes them without the author's email.
UPDATE "projects" AS p SET "updated_at" = now() FROM "user" AS u WHERE u."id" = p."author_user_id" AND u."banned" IS TRUE;
--> statement-breakpoint
INSERT INTO "audit_events" ("actor_user_id", "actor_name", "action", "subject_type", "subject_id", "detail")
  SELECT NULL, NULL, 'user.removed', 'user', u."id",
         jsonb_build_object('name', u."name", 'email', u."email", 'blocked', true, 'reason', 'ban_migrated', 'banReason', u."ban_reason")
    FROM "user" AS u WHERE u."banned" IS TRUE;
--> statement-breakpoint
INSERT INTO "audit_events" ("actor_user_id", "actor_name", "action", "subject_type", "subject_id", "detail")
  SELECT NULL, NULL, 'email.blocked', 'email', lower(trim(u."email")), jsonb_build_object('reason', 'ban_migrated', 'userId', u."id")
    FROM "user" AS u WHERE u."banned" IS TRUE;
--> statement-breakpoint
-- Sessions, accounts, tokens, grants, allowances and a mirror follow their
-- foreign keys; every actor column is `set null`.
DELETE FROM "user" WHERE "banned" IS TRUE;