-- Phase 5: the three remaining `user.id` foreign keys (spec §4.4, §4.8, §4.10).
--
-- `tools.last_reviewed_by`, `maintenance_logs.assigned_to_user_id` and
-- `projects.published_by` were written as bare `text` by Phase 1, for the
-- reason `created_by` / `updated_by` were: `user` did not exist until Phase 4.
-- Phase 5 is the first code that writes any of them — the review mark, the
-- assignee, the moderation decision — so an id naming no row would have been
-- stored without complaint and rendered as nothing.
--
-- All three are `on delete set null`, like every other actor column: removing
-- a person must never remove the work. It is also why `last_reviewed_at`,
-- `assigned_to_name` and `published_at` are worth keeping beside them — they
-- are what is left when the account goes.
--
-- Safe on real data as long as no non-null value names a missing row; every
-- existing value is null (the import and the demo seed never set them, and the
-- code that does arrives with this phase). A production database should still
-- be checked first, the way `0003` asks:
--   select count(*) from tools t left join "user" u on u.id = t.last_reviewed_by
--    where t.last_reviewed_by is not null and u.id is null;   -- and so on

ALTER TABLE "tools" ADD CONSTRAINT "tools_last_reviewed_by_user_id_fk" FOREIGN KEY ("last_reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;