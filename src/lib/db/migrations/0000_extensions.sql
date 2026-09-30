-- Extensions the schema depends on (data platform design spec 2026-09-14 §3.2).
-- pg_trgm backs the trigram index on tools.name used by the duplicate check.
-- Neon ships it; PGlite loads it at construction (see src/lib/db/pglite.ts).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
