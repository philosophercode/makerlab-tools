import { compactNotionId, isLegacyNotionId, normaliseNotionId } from "./legacy-id";

const DASHED = "0f5e2c1a-4b6d-4e8f-9a0b-1c2d3e4f5a6b";
const COMPACT = "0f5e2c1a4b6d4e8f9a0b1c2d3e4f5a6b";

describe("isLegacyNotionId", () => {
  it("accepts a Notion page id with and without dashes, in either case", () => {
    expect(isLegacyNotionId(DASHED)).toBe(true);
    expect(isLegacyNotionId(COMPACT)).toBe(true);
    expect(isLegacyNotionId(DASHED.toUpperCase())).toBe(true);
    expect(isLegacyNotionId(COMPACT.toUpperCase())).toBe(true);
    expect(isLegacyNotionId(` ${DASHED} `)).toBe(true);
  });

  it("rejects slugs, which is the whole point of the check", () => {
    for (const slug of [
      "form-4",
      "trotec-speedy-400",
      "bantam-tools-desktop-cnc-milling-machine",
      "0f5e2c1a", // a truncated id
      `${COMPACT}0`, // 33 characters
      "0f5e2c1a-4b6d-4e8f-9a0b-1c2d3e4f5a6z", // not hex
      "0f5e2c1a4b6d-4e8f9a0b1c2d3e4f5a6b", // dashes in the wrong places
      "",
    ]) {
      expect(isLegacyNotionId(slug)).toBe(false);
    }
  });
});

describe("compactNotionId", () => {
  it("reduces both spellings to the same comparison key", () => {
    expect(compactNotionId(DASHED)).toBe(COMPACT);
    expect(compactNotionId(COMPACT)).toBe(COMPACT);
    expect(compactNotionId(DASHED.toUpperCase())).toBe(COMPACT);
  });

  it("returns null for a slug", () => {
    expect(compactNotionId("form-4")).toBeNull();
  });
});

describe("normaliseNotionId", () => {
  it("returns the dashed lower-case form Notion's API uses", () => {
    expect(normaliseNotionId(COMPACT)).toBe(DASHED);
    expect(normaliseNotionId(DASHED)).toBe(DASHED);
    expect(normaliseNotionId(COMPACT.toUpperCase())).toBe(DASHED);
  });

  it("returns null for a slug", () => {
    expect(normaliseNotionId("trotec-speedy-400")).toBeNull();
  });
});
