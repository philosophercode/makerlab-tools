-- Manual text spec phase 3: OCR for scanned manuals and half-precision vectors.
--
-- halfvec: pgvector 0.7+ (Neon ships 0.8; PGlite's pglite-pgvector 0.0.9 is
-- 0.8.1). The HNSW index is dropped before the column changes type — a
-- vector_cosine_ops index cannot hold halfvec — and rebuilt with
-- halfvec_cosine_ops. Existing embeddings are converted in place by pgvector's
-- vector -> halfvec cast (USING, hand-added), so no passage is re-embedded.
-- ocr_version and manual_pages.source are new nullable/defaulted columns:
-- every existing page is 'text'.
DROP INDEX "manual_chunks_embedding_idx";--> statement-breakpoint
ALTER TABLE "manual_chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(512) USING "embedding"::halfvec(512);--> statement-breakpoint
ALTER TABLE "manual_documents" ADD COLUMN "ocr_version" text;--> statement-breakpoint
ALTER TABLE "manual_pages" ADD COLUMN "source" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
CREATE INDEX "manual_chunks_embedding_idx" ON "manual_chunks" USING hnsw ("embedding" halfvec_cosine_ops);--> statement-breakpoint
ALTER TABLE "manual_pages" ADD CONSTRAINT "manual_pages_source_check" CHECK ("source" in ('text', 'ocr'));
