import en from "../../../messages/en.json";
import { personLabel } from "./person-label";

/** "(removed)" beside a snapshot name (auth spec amendment 2026-09-25). */

const t = (key: "removedName" | "removedUser", values?: Record<string, string>) =>
  en.admin.people[key].replace("{name}", values?.name ?? "");

describe("personLabel", () => {
  it("leaves a person still on the roster as their name", () => {
    expect(personLabel(t, "Ada Lovelace", false)).toBe("Ada Lovelace");
    expect(personLabel(t, null, false)).toBe("");
  });

  it("marks a removed person, and names one with no name at all", () => {
    expect(personLabel(t, "Ada Lovelace", true)).toBe("Ada Lovelace (removed)");
    expect(personLabel(t, "  ", true)).toBe("Removed user");
  });
});
