import { createHash } from "node:crypto";
import {
  API_TOKEN_PREFIX,
  displayPrefix,
  generateApiToken,
  hashApiToken,
  looksLikeApiToken,
  prefixOf,
} from "./api-token-format";

/** A personal access token's shape (MCP access spec §3.1, §4.1). */
describe("personal access token format", () => {
  it("is mlt_ followed by 32 random bytes as base64url", () => {
    const { token } = generateApiToken();
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^mlt_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.slice(4), "base64url")).toHaveLength(32);
    expect(looksLikeApiToken(token)).toBe(true);
  });

  it("is different every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateApiToken().token));
    expect(tokens.size).toBe(50);
  });

  it("hashes with SHA-256, hex, and the hash is not the token", () => {
    const { token, hash } = generateApiToken();
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4));
    expect(hashApiToken(token)).toBe(hash);
  });

  it("keeps the first eight characters after mlt_ for display", () => {
    const { token, prefix } = generateApiToken();
    expect(prefix).toBe(token.slice(4, 12));
    expect(prefixOf(token)).toBe(prefix);
    expect(displayPrefix(prefix)).toBe(`mlt_${prefix}…`);
  });

  it("does not mistake other bearer values for one", () => {
    expect(looksLikeApiToken("mlt_short")).toBe(false);
    expect(looksLikeApiToken("secret-mcp")).toBe(false);
    expect(looksLikeApiToken(`xyz_${"a".repeat(43)}`)).toBe(false);
  });
});
