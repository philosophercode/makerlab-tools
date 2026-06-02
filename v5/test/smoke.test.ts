// Canary test proving the harness boots: globals work, the `@/` alias resolves,
// and TS/TSX source transforms under Vitest. Leave this in place — if it goes
// red, the shared harness is broken before any feature test runs.
import { isSupportedLocale } from "@/i18n/config";

describe("harness smoke", () => {
  it("runs with globals enabled", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves the @/ alias and transforms src TS", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("xx")).toBe(false);
  });
});
