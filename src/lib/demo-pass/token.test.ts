// @vitest-environment node
import { signDemoPass, verifyDemoPass } from "./token";

/**
 * The demo pass cookie's value (demo pass spec 2026-10-07 §5.2): it names a
 * pass and proves the server set it, and every way it can be wrong is null.
 */

const SECRET = "demo-pass-token-test-secret";
const PASS = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NOW = new Date("2026-10-11T15:00:00.000Z");
const LATER = new Date("2026-10-25T15:00:00.000Z");

describe("demo pass tokens", () => {
  it("round-trips the pass id and its end", async () => {
    const value = await signDemoPass({ passId: PASS, expiresAt: LATER }, SECRET);
    expect(value).toMatch(/^v1\.3f2504e0-4f89-41d3-9a0c-0305e82c3301\.\d+\.[A-Za-z0-9_-]+$/);
    expect(await verifyDemoPass(value, SECRET, NOW)).toEqual({ passId: PASS, expiresAt: LATER });
  });

  it("refuses a value signed with another secret", async () => {
    const value = await signDemoPass({ passId: PASS, expiresAt: LATER }, "another-secret");
    expect(await verifyDemoPass(value, SECRET, NOW)).toBeNull();
  });

  it("refuses a value whose pass id or end was changed", async () => {
    const value = (await signDemoPass({ passId: PASS, expiresAt: LATER }, SECRET))!;
    const [version, , expires, signature] = value.split(".");
    const otherPass = [version, "3f2504e0-4f89-41d3-9a0c-0305e82c3399", expires, signature].join(".");
    const longer = [version, PASS, String(Number(expires) + 86_400), signature].join(".");
    expect(await verifyDemoPass(otherPass, SECRET, NOW)).toBeNull();
    expect(await verifyDemoPass(longer, SECRET, NOW)).toBeNull();
  });

  it("refuses a value past its end", async () => {
    const value = await signDemoPass({ passId: PASS, expiresAt: LATER }, SECRET);
    expect(await verifyDemoPass(value, SECRET, new Date(LATER.getTime() + 1000))).toBeNull();
  });

  it("refuses everything malformed, and everything when there is no secret", async () => {
    const value = await signDemoPass({ passId: PASS, expiresAt: LATER }, SECRET);
    for (const bad of [null, undefined, "", "v1", "v1.x.y.z", `v2.${PASS}.1.abc`, `${value}.extra`, "x".repeat(300)]) {
      expect(await verifyDemoPass(bad, SECRET, NOW)).toBeNull();
    }
    expect(await verifyDemoPass(value, "", NOW)).toBeNull();
    expect(await signDemoPass({ passId: PASS, expiresAt: LATER }, "")).toBeNull();
    expect(await signDemoPass({ passId: "not-a-uuid", expiresAt: LATER }, SECRET)).toBeNull();
  });
});
