-- updated_at is maintained by the database, not the ORM (spec §4): the import,
-- the demo seed and any manual SQL fix write outside Drizzle, and the Notion
-- mirror selects on this column. One function, one trigger per mutable table.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER locations_set_updated_at BEFORE UPDATE ON "locations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tools_set_updated_at BEFORE UPDATE ON "tools" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER units_set_updated_at BEFORE UPDATE ON "units" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER resources_set_updated_at BEFORE UPDATE ON "resources" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attachments_set_updated_at BEFORE UPDATE ON "attachments" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER maintenance_logs_set_updated_at BEFORE UPDATE ON "maintenance_logs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER feedback_set_updated_at BEFORE UPDATE ON "feedback" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON "projects" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
