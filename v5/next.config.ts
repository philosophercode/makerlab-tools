import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withWorkflow } from "workflow/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Without `BLOB_READ_WRITE_TOKEN`, `next dev` stores uploads in `.blob-data/`
// and serves public ones from `/api/dev-blob/…` on its own origin
// (src/lib/blob-local.ts). Allowed for next/image in development only; a
// production build never has these patterns.
const isDev = process.env.NODE_ENV !== "production";
const devBlobPatterns: NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> = isDev
  ? [
      { protocol: "http", hostname: "localhost", pathname: "/api/dev-blob/**" },
      { protocol: "http", hostname: "127.0.0.1", pathname: "/api/dev-blob/**" },
    ]
  : [];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PGlite ships its WASM build and its extension tarballs as files it locates
  // with `import.meta.url`. Bundled into the server output those become
  // `/_next/static/media/...` URLs that nothing can read from disk, so a build
  // or a request without `DATABASE_URL` dies on "Extension bundle not found".
  // Kept external, it loads from node_modules and the demo database works in a
  // built app exactly as it does under `next dev` (spec §3.2).
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector"],
  images: {
    localPatterns: [
      {
        pathname: "/tool-images/**",
      },
      {
        // Photos for the demo seed's sample project (src/lib/db/demo-seed.ts).
        pathname: "/sample-projects/**",
      },
      {
        pathname: "/makerlab-logo-transparent.png",
      },
      {
        pathname: "/makerlab-logo-blackonly.png",
      },
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "prod-files-secure.s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "v5.airtableusercontent.com",
      },
      // The Notion/S3/Airtable patterns above can go once every image has been
      // re-imported to Vercel Blob; until then, rows imported before the switch
      // may still reference them.
      ...devBlobPatterns,
    ],
    // The local Blob store's files are served by this same dev server, and the
    // optimizer refuses loopback addresses unless told otherwise. Dev only.
    dangerouslyAllowLocalIP: isDev,
    minimumCacheTTL: 3600,
  },
};

// The Workflow SDK (spec §3.7) wraps the next-intl-wrapped config: it compiles
// files marked "use workflow" / "use step" and generates the routes the runtime
// calls under `src/app/.well-known/workflow/` at build time (ignored by git,
// ESLint and tsc). The composition — `withWorkflow(withNextIntl(...))` with
// `cacheComponents` on, under Turbopack — was verified on this exact stack by
// the 2026-09-22 amendment, which also records why Phase 6 uses the Workflow
// SDK at all and that `@workflow/world-vercel` is never installed: on Vercel it
// is selected automatically, and locally runs are kept in a folder on disk.
export default withWorkflow(withNextIntl(nextConfig));
