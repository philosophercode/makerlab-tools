import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withWorkflow } from "workflow/next";
import {
  DEV_SIGN_IN_BUILD_MESSAGE,
  devSignInBuildVerdict,
} from "./src/lib/auth/dev-sign-in-build-check";
import { blobImagePatterns } from "./src/lib/images/remote-patterns";

// Development-only sign-in (auth spec amendment 2026-09-24) must never be
// configured on a deployment. The route refuses outside `next dev` regardless;
// this stops a Vercel build that sets the variable, and warns a local one.
const devSignInVerdict = devSignInBuildVerdict(process.env);
if (devSignInVerdict === "fail") throw new Error(DEV_SIGN_IN_BUILD_MESSAGE);
if (devSignInVerdict === "warn") {
  console.warn(`[dev-sign-in] ${DEV_SIGN_IN_BUILD_MESSAGE} (Inert in this production build.)`);
}

// A deployment build with no Blob store id has no remote image host at all, so
// every Blob photo would fail to optimize. Say so in the build log.
if (process.env.VERCEL && blobImagePatterns(process.env).length === 0) {
  console.warn(
    "[images] No Blob store id at build time (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN): next/image will refuse Blob photos."
  );
}

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

// What no server function reads at runtime, kept out of every function's file
// trace. `blob-local.ts`, `local-dir.ts` and `migrations-folder.ts` join paths
// onto `process.cwd()`, so the tracer copies the whole project — including the
// ~78 MB of committed `public/tool-images` — into each function (performance
// plan, quick win 3). `public/` is served by the CDN, never read with `fs`.
// PGlite (~21 MB) is left out only when the build has `DATABASE_URL`: that
// deployment talks to Neon and `db/client.ts` imports PGlite lazily, so it is
// never loaded. A build without `DATABASE_URL` (a preview, E2E) keeps it for
// the demo database.
// These globs are matched against paths relative to this folder.
const traceExcludes = [
  "public/**",
  ".blob-data/**",
  ".blob-data-e2e/**",
  ".pglite-data/**",
  ".workflow-data/**",
  ".workflow-vitest/**",
  ".swc/**",
  "*.tsbuildinfo",
  "package-lock.json",
  "e2e/**",
  "evals/**",
  "test/**",
  "scripts/**",
  "docs/**",
  // Agent worktrees (untracked, local only): whole copies of this repo.
  ".claude/**",
  // `npm run projects:seed`'s bundle (#99): read by the script, never at runtime.
  "data/**",
  "*.md",
  // The TypeScript sources are compiled into `.next/`; only the SQL migrations
  // (read by the demo database's migrator) and generated JSON stay traced.
  "src/**/*.{ts,tsx,css,woff2,txt}",
  ...(process.env.DATABASE_URL
    ? ["node_modules/@electric-sql/pglite/**", "node_modules/@electric-sql/pglite-pgvector/**"]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The app is the repository root. Pin it: agent worktrees are checkouts
  // nested inside the main one, and with two lockfiles on the path Next would
  // otherwise infer the outer checkout as the workspace (and tracing) root.
  turbopack: { root: import.meta.dirname },
  outputFileTracingExcludes: { "*": traceExcludes },
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
    // The lab's own public Blob store only (src/lib/images/remote-patterns.ts):
    // the optimizer is unauthenticated and billed per source, so a wildcard
    // over every Vercel Blob store or S3 bucket let anyone use it as a free
    // image proxy. The Notion, S3, Unsplash and Airtable hosts went with it:
    // the import copies bytes to Blob, and Notion's and Airtable's file URLs
    // are signed and expire.
    remotePatterns: [
      ...blobImagePatterns(process.env),
      ...devBlobPatterns,
    ],
    // The local Blob store's files are served by this same dev server, and the
    // optimizer refuses loopback addresses unless told otherwise. Dev only.
    dangerouslyAllowLocalIP: isDev,
    // The fallback path only: tool photos are served from pre-rendered
    // thumbnails (`src/lib/images/thumbnail-urls.ts`), and next/image resizes
    // an original only until its thumbnails exist. AVIF first, as they are.
    formats: ["image/avif", "image/webp"],
    // Blob pathnames are random and never rewritten, so an optimized copy
    // cannot go stale: keep it for 31 days rather than re-optimizing (and
    // re-billing) it every hour.
    minimumCacheTTL: 2_678_400,
  },
  async headers() {
    return [
      {
        // Content-hashed file names (`npm run thumbnails:bundled`): a changed
        // photo gets new URLs, so these never need revalidating.
        source: "/tool-images/thumbs/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
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
