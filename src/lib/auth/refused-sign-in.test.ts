// @vitest-environment node
/**
 * The refused-address cookie (auth spec amendment 2026-10-07). The page prints
 * what this decodes, so the properties worth pinning are: only a value this app
 * signed reads back, it expires inside the signed part, and the return path is
 * always one of this origin's own.
 */
import {
  REFUSED_SIGN_IN_COOKIE,
  REFUSED_SIGN_IN_MAX_AGE_SECONDS,
  decodeRefusedSignIn,
  encodeRefusedSignIn,
  forgetRefusedSignIn,
  rememberRefusedSignIn,
  safeRetryPath,
} from "./refused-sign-in";

const SECRET = "refused-test-secret";
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

describe("encode / decode", () => {
  it("round-trips the address and the return path", () => {
    const value = encodeRefusedSignIn({ email: "someone@gmail.com", retryPath: "/tools/form-4" }, SECRET, NOW);
    expect(decodeRefusedSignIn(value, SECRET, NOW)).toEqual({
      email: "someone@gmail.com",
      retryPath: "/tools/form-4",
    });
  });

  it("does not put the address in the clear", () => {
    const value = encodeRefusedSignIn({ email: "someone@gmail.com", retryPath: "/" }, SECRET, NOW);
    expect(value).not.toContain("someone");
  });

  it("reads nothing from a value signed with another secret, or edited", () => {
    const value = encodeRefusedSignIn({ email: "someone@gmail.com", retryPath: "/" }, SECRET, NOW);
    expect(decodeRefusedSignIn(value, `${SECRET}-other`, NOW)).toBeNull();

    const [payload, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ e: "<b>hi</b>", r: "/", x: NOW / 1000 + 600 })).toString("base64url");
    expect(decodeRefusedSignIn(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
    expect(decodeRefusedSignIn(`${payload}.`, SECRET, NOW)).toBeNull();
  });

  it("expires after ten minutes, whatever the browser does with Max-Age", () => {
    const value = encodeRefusedSignIn({ email: "someone@gmail.com", retryPath: "/" }, SECRET, NOW);
    const later = NOW + (REFUSED_SIGN_IN_MAX_AGE_SECONDS + 1) * 1000;
    expect(decodeRefusedSignIn(value, SECRET, later)).toBeNull();
  });

  it("reads nothing from nothing, or without a secret", () => {
    expect(decodeRefusedSignIn(undefined, SECRET)).toBeNull();
    expect(decodeRefusedSignIn("", SECRET)).toBeNull();
    expect(decodeRefusedSignIn("no-dot-here", SECRET)).toBeNull();
    expect(decodeRefusedSignIn("a.b", "")).toBeNull();
  });
});

describe("safeRetryPath", () => {
  const ORIGIN = "https://makerlab.example";

  it("keeps this origin's own paths, query included", () => {
    expect(safeRetryPath("/tools/form-4")).toBe("/tools/form-4");
    expect(safeRetryPath("/api/auth/mcp/authorize?client_id=abc&state=1")).toBe(
      "/api/auth/mcp/authorize?client_id=abc&state=1"
    );
  });

  it("drops the origin from an absolute URL on this origin", () => {
    expect(safeRetryPath(`${ORIGIN}/tools?x=1`, ORIGIN)).toBe("/tools?x=1");
  });

  it("sends anything else home", () => {
    expect(safeRetryPath("https://evil.example/tools", ORIGIN)).toBe("/");
    expect(safeRetryPath("//evil.example/tools", ORIGIN)).toBe("/");
    expect(safeRetryPath("/\\evil.example", ORIGIN)).toBe("/");
    expect(safeRetryPath("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(safeRetryPath(`/${"a".repeat(2000)}`, ORIGIN)).toBe("/");
    expect(safeRetryPath(undefined)).toBe("/");
    expect(safeRetryPath("tools")).toBe("/");
  });
});

describe("remember / forget", () => {
  it("sets an HttpOnly, Lax, ten-minute cookie", () => {
    const setCookie = vi.fn();
    rememberRefusedSignIn({ setCookie }, { email: "a@gmail.com", retryPath: "/" }, { secret: SECRET, secure: true });
    expect(setCookie).toHaveBeenCalledWith(REFUSED_SIGN_IN_COOKIE, expect.any(String), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REFUSED_SIGN_IN_MAX_AGE_SECONDS,
      secure: true,
    });
    expect(decodeRefusedSignIn(setCookie.mock.calls[0][1], SECRET)?.email).toBe("a@gmail.com");
  });

  it("does nothing without a request in flight", () => {
    expect(() =>
      rememberRefusedSignIn(null, { email: "a@gmail.com", retryPath: "/" }, { secret: SECRET, secure: false })
    ).not.toThrow();
  });

  it("expires the cookie", () => {
    const setCookie = vi.fn();
    forgetRefusedSignIn({ setCookie }, { secure: false });
    expect(setCookie).toHaveBeenCalledWith(REFUSED_SIGN_IN_COOKIE, "", expect.objectContaining({ maxAge: 0 }));
  });
});
