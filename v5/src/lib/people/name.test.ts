import { isPlaceholderName, normalizeName, PERSON_NAME_MAX_LENGTH } from "./name";

describe("normalizeName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeName("  Ada \n\t Lovelace ")).toEqual({ ok: true, name: "Ada Lovelace" });
  });

  it("keeps a name of exactly the limit, and refuses one character more rather than cutting it", () => {
    expect(PERSON_NAME_MAX_LENGTH).toBe(80);
    expect(normalizeName("x".repeat(80))).toEqual({ ok: true, name: "x".repeat(80) });
    expect(normalizeName("x".repeat(81))).toEqual({ ok: false });
  });

  it("refuses blank, and anything that is not a string", () => {
    for (const raw of ["", "   ", null, undefined, 42, {}]) expect(normalizeName(raw)).toEqual({ ok: false });
  });
});

describe("isPlaceholderName", () => {
  it("is true for the address standing in as the name, in any case", () => {
    expect(isPlaceholderName({ name: "luis@cornell.edu", email: "luis@cornell.edu" })).toBe(true);
    expect(isPlaceholderName({ name: "Luis@Cornell.edu", email: "luis@cornell.edu" })).toBe(true);
  });

  it("is true for no name at all", () => {
    expect(isPlaceholderName({ name: "  ", email: "luis@cornell.edu" })).toBe(true);
    expect(isPlaceholderName({ name: null, email: "luis@cornell.edu" })).toBe(true);
  });

  it("is false for a name somebody chose", () => {
    expect(isPlaceholderName({ name: "Luis Example", email: "luis@cornell.edu" })).toBe(false);
  });
});
