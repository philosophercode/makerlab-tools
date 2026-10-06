// @vitest-environment node
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";
import { REMOTE_IMAGE_PATTERNS } from "./remote-patterns";

// Next's own matcher, so the test reads the patterns as `/_next/image` does.
const allowed = (url: string) => hasRemoteMatch([], REMOTE_IMAGE_PATTERNS, new URL(url));

describe("REMOTE_IMAGE_PATTERNS", () => {
  it("allows Blob photos and Notion's legacy S3 files", () => {
    expect(allowed("https://abc123.public.blob.vercel-storage.com/tools/form-4.png")).toBe(true);
    expect(allowed("https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/photo.png")).toBe(true);
    expect(allowed("https://s3.us-west-2.amazonaws.com/secure.notion-static.com/abc/photo.png")).toBe(true);
  });

  it("refuses any other bucket on the path-style S3 host", () => {
    expect(allowed("https://s3.us-west-2.amazonaws.com/someone-elses-bucket/x.jpg")).toBe(false);
    expect(allowed("https://s3.us-west-2.amazonaws.com/secure.notion-static.com.evil/x.jpg")).toBe(false);
  });

  it("allows only https", () => {
    for (const pattern of REMOTE_IMAGE_PATTERNS) expect(pattern.protocol).toBe("https");
  });
});
