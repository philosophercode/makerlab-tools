import { requestOrigin } from "./request-origin";

/** The origin `/mcp` shows its addresses for (MCP access spec, amendment 2026-09-25). */

function from(init: Record<string, string>) {
  return requestOrigin(new Headers(init));
}

it("uses the forwarded host and scheme behind a proxy", () => {
  expect(from({ host: "internal:3000", "x-forwarded-host": "tools.example.edu", "x-forwarded-proto": "https" })).toBe(
    "https://tools.example.edu"
  );
});

it("uses http for a loopback host and https otherwise", () => {
  expect(from({ host: "localhost:3031" })).toBe("http://localhost:3031");
  expect(from({ host: "127.0.0.1:3031" })).toBe("http://127.0.0.1:3031");
  expect(from({ host: "tools.example.edu" })).toBe("https://tools.example.edu");
});

it("takes the first of a comma-separated list", () => {
  expect(from({ "x-forwarded-host": "a.example.edu, b.example.edu", "x-forwarded-proto": "https,http" })).toBe(
    "https://a.example.edu"
  );
});

it("answers null for no host or one that is not a host", () => {
  expect(from({})).toBeNull();
  expect(from({ host: "evil.example/<script>" })).toBeNull();
});
