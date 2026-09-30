import {
  devSignInAllowed,
  devSignInEnvEnabled,
  isLoopbackRequest,
  safeNextPath,
} from "./dev-sign-in";
import { devSignInBuildVerdict } from "./dev-sign-in-build-check";

afterEach(() => {
  vi.unstubAllEnvs();
});

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("devSignInEnvEnabled", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DEV_AUTO_SIGN_IN", "1");
  });

  it("is on only with development, no VERCEL, and DEV_AUTO_SIGN_IN=1", () => {
    expect(devSignInEnvEnabled()).toBe(true);
  });

  it.each([
    ["NODE_ENV=production", "NODE_ENV", "production"],
    ["NODE_ENV=test", "NODE_ENV", "test"],
    ["VERCEL=1", "VERCEL", "1"],
    ["DEV_AUTO_SIGN_IN unset", "DEV_AUTO_SIGN_IN", ""],
    ["DEV_AUTO_SIGN_IN=true (only 1 counts)", "DEV_AUTO_SIGN_IN", "true"],
  ])("is off with %s", (_label, name, value) => {
    vi.stubEnv(name, value);
    expect(devSignInEnvEnabled()).toBe(false);
  });
});

describe("isLoopbackRequest", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:4000", "[::1]:3000", "LOCALHOST:3000"])(
    "accepts Host %s",
    (host) => {
      expect(isLoopbackRequest(headers({ host }))).toBe(true);
    }
  );

  it("accepts the loopback forwarding headers next dev adds itself", () => {
    expect(
      isLoopbackRequest(
        headers({
          host: "localhost:3000",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-for": "::1",
        })
      )
    ).toBe(true);
    expect(
      isLoopbackRequest(headers({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" }))
    ).toBe(true);
  });

  it.each([
    ["no Host", {}],
    ["an ngrok host", { host: "x.ngrok-free.dev" }],
    ["a LAN address", { host: "192.168.1.20:3000" }],
    ["a lookalike", { host: "localhost.evil.com" }],
    ["a userinfo trick", { host: "localhost@evil.com" }],
    ["a non-numeric port", { host: "localhost:abc" }],
    ["a forwarded foreign host", { host: "localhost:3000", "x-forwarded-host": "x.ngrok-free.dev" }],
    ["a forwarded visitor address", { host: "localhost:3000", "x-forwarded-for": "198.51.100.4, 127.0.0.1" }],
    ["a Cloudflare visitor", { host: "localhost:3000", "cf-connecting-ip": "198.51.100.4" }],
    ["an RFC 7239 Forwarded", { host: "localhost:3000", forwarded: "for=198.51.100.4" }],
  ])("refuses %s", (_label, values) => {
    expect(isLoopbackRequest(headers(values as Record<string, string>))).toBe(false);
  });
});

describe("devSignInAllowed", () => {
  it("needs both the environment and a loopback request", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DEV_AUTO_SIGN_IN", "1");
    expect(devSignInAllowed(headers({ host: "localhost:3000" }))).toBe(true);
    expect(devSignInAllowed(headers({ host: "x.ngrok-free.dev" }))).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(devSignInAllowed(headers({ host: "localhost:3000" }))).toBe(false);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/users?q=a#top", "/admin/users?q=a#top"],
    ["/", "/"],
  ])("keeps %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    "",
    "admin",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "\n//evil.com",
    "javascript:alert(1)",
  ])("sends %j to /", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });
});

describe("devSignInBuildVerdict", () => {
  it("is fine without the variable", () => {
    expect(devSignInBuildVerdict({ NODE_ENV: "production", VERCEL: "1" })).toBe("ok");
  });

  it("fails a Vercel build that sets it", () => {
    expect(devSignInBuildVerdict({ DEV_AUTO_SIGN_IN: "1", VERCEL: "1", NODE_ENV: "production" })).toBe(
      "fail"
    );
  });

  it("warns on a local production build, where it is inert", () => {
    expect(devSignInBuildVerdict({ DEV_AUTO_SIGN_IN: "1", NODE_ENV: "production" })).toBe("warn");
  });

  it("is fine under next dev", () => {
    expect(devSignInBuildVerdict({ DEV_AUTO_SIGN_IN: "1", NODE_ENV: "development" })).toBe("ok");
  });
});
