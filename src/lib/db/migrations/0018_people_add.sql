ALTER TABLE "user" ADD COLUMN "first_signed_in_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
UPDATE "user" SET "first_signed_in_at" = "created_at";
