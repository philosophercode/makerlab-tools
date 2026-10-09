-- Who is on shift (on-shift spec 2026-10-07): one row per staff member who
-- marked themselves on shift, and until when. Readers filter on ends_at > now,
-- so a shift ends by itself. No new personal data: an id and two times.
CREATE TABLE "staff_shifts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;