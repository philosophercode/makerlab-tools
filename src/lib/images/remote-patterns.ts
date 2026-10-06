/**
 * The hosts `next/image` may fetch and optimize in a production build
 * (`next.config.ts` adds the dev-only local Blob patterns). Relative imports
 * only: `next.config.ts` loads it outside Next's bundler.
 *
 * Every entry is a host anyone can make `/_next/image` fetch and transform at
 * this project's expense, so each is kept as narrow as the images it exists
 * for (operational hardening spec, amendment 2026-10-05).
 */
export type ImageRemotePattern = {
  protocol: "https" | "http";
  hostname: string;
  pathname?: string;
};

export const REMOTE_IMAGE_PATTERNS: ImageRemotePattern[] = [
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
    // Path-style S3 serves every bucket in the region from this one host;
    // only Notion's legacy file bucket is ours.
    pathname: "/secure.notion-static.com/**",
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
];
