import { describe, expect, it } from "vitest";
import { identityFor } from "../../../test/utils/identities";
import { ROLES } from "../db/schema/vocabulary";
import { canSeeMap } from "./access";

describe("canSeeMap (map access, PR #98)", () => {
  it("refuses a caller who is not signed in", () => {
    expect(canSeeMap(undefined)).toBe(false);
    expect(canSeeMap(null)).toBe(false);
    expect(canSeeMap(identityFor("anonymous"))).toBe(false);
  });

  it("refuses an identity with a role but no user row", () => {
    expect(canSeeMap(identityFor("user", { userId: null }))).toBe(false);
  });

  it("admits every signed-in role", () => {
    for (const role of ROLES) {
      expect(canSeeMap(identityFor(role))).toBe(true);
    }
  });
});
