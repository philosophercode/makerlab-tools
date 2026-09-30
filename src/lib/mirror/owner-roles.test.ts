import { can } from "../auth/permissions";
import { ROLES } from "../db/schema/vocabulary";
import { MIRROR_OWNER_ROLES } from "./owner-roles";

describe("MIRROR_OWNER_ROLES", () => {
  it("is exactly the stored roles that can() grants mirror.manage", () => {
    const granted = ROLES.filter((role) => can({ role }, "mirror.manage"));
    expect([...MIRROR_OWNER_ROLES].sort()).toEqual([...granted].sort());
  });
});
