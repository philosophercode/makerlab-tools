import en from "../../../messages/en.json";
import type { Role } from "../db/schema/vocabulary";
import { displayTitle, normalizeTitle, USER_TITLE_MAX_LENGTH } from "./title";

/** A person's title: custom when set, else the role's default label. */

const roleDefault = (role: Role) => en.admin.titles[role];

describe("displayTitle", () => {
  it("gives each role its default label when there is no custom title", () => {
    expect(displayTitle({ role: "super_admin", title: null }, roleDefault)).toBe("Super Admin");
    expect(displayTitle({ role: "admin", title: null }, roleDefault)).toBe("Supermaker");
    expect(displayTitle({ role: "user" }, roleDefault)).toBe("Student");
  });

  it("prefers a custom title over the role's", () => {
    expect(displayTitle({ role: "user", title: "Shop Assistant" }, roleDefault)).toBe("Shop Assistant");
  });

  it("treats a blank custom title as none", () => {
    expect(displayTitle({ role: "admin", title: "   " }, roleDefault)).toBe("Supermaker");
    expect(displayTitle({ role: "admin", title: "" }, roleDefault)).toBe("Supermaker");
  });
});

describe("normalizeTitle", () => {
  it("trims, and collapses inner whitespace to one space", () => {
    expect(normalizeTitle("  Lab   Director\n")).toEqual({ ok: true, title: "Lab Director" });
  });

  it("reads blank and null as 'no custom title'", () => {
    expect(normalizeTitle("")).toEqual({ ok: true, title: null });
    expect(normalizeTitle("   ")).toEqual({ ok: true, title: null });
    expect(normalizeTitle(null)).toEqual({ ok: true, title: null });
    expect(normalizeTitle(undefined)).toEqual({ ok: true, title: null });
  });

  it("accepts exactly the maximum and refuses one more, counted after trimming", () => {
    const longest = "x".repeat(USER_TITLE_MAX_LENGTH);
    expect(normalizeTitle(`  ${longest}  `)).toEqual({ ok: true, title: longest });
    expect(normalizeTitle(`${longest}x`)).toEqual({ ok: false });
  });

  it("refuses anything that is not text", () => {
    expect(normalizeTitle(42)).toEqual({ ok: false });
    expect(normalizeTitle({ title: "x" })).toEqual({ ok: false });
  });
});
