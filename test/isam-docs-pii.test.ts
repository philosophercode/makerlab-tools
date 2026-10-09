// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The repo is public. The ISAM author list once carried a co-author's personal
 * webmail address; contact details for people who are not staff belong in the
 * paper submission, not here. Only the text sources are scanned — the frozen
 * .docx/.pdf records are binary.
 */
const DIR = join(process.cwd(), "docs/isam-2026-demo");
const PERSONAL_WEBMAIL =
  /[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail)\.(com|me)\b/i;

describe("ISAM demo docs", () => {
  const files = readdirSync(DIR).filter((f) => /\.(md|html)$/.test(f));

  it("has text sources to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s carries no personal webmail address", (file) => {
    const text = readFileSync(join(DIR, file), "utf8");
    // Report the file only, never the address itself.
    expect(PERSONAL_WEBMAIL.test(text)).toBe(false);
  });
});
