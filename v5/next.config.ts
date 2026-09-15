import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  cacheComponents: true,
  // PGlite ships its WASM build and its extension tarballs as files it locates
  // with `import.meta.url`. Bundled into the server output those become
  // `/_next/static/media/...` URLs that nothing can read from disk, so a build
  // or a request without `DATABASE_URL` dies on "Extension bundle not found".
  // Kept external, it loads from node_modules and the demo database works in a
  // built app exactly as it does under `next dev` (spec §3.2).
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    localPatterns: [
      {
        pathname: "/tool-images/**",
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
    ],
    minimumCacheTTL: 3600,
  },
};

export default withNextIntl(nextConfig);
