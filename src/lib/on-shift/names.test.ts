import { shiftDisplayName, visibleOnShift, type ShiftRow } from "./names";

/**
 * Who students see on shift (on-shift spec 2026-10-07 §5.3): only shifts
 * that have not ended, only people who may hold one, only real names, as
 * first name and last initial. Nobody is an empty list, never a stand-in.
 */

const NOW = new Date("2026-10-07T18:00:00Z");
const LATER = "2026-10-07T22:00:00.000Z";
const EARLIER = "2026-10-07T17:00:00.000Z";

function row(overrides: Partial<ShiftRow> = {}): ShiftRow {
  return { name: "Alex Morgan", endsAt: LATER, eligible: true, ...overrides };
}

describe("visibleOnShift", () => {
  it("shows a staff member on shift as first name and last initial", () => {
    expect(visibleOnShift([row()], NOW)).toEqual(["Alex M."]);
  });

  it("is empty when nobody is on shift: no stand-in name, ever", () => {
    expect(visibleOnShift([], NOW)).toEqual([]);
  });

  it("drops a shift that has ended: it ends by itself, with nothing to sweep", () => {
    expect(visibleOnShift([row({ endsAt: EARLIER })], NOW)).toEqual([]);
    // Exactly at the end is over.
    expect(visibleOnShift([row({ endsAt: NOW.toISOString() })], NOW)).toEqual([]);
    // The same row, read an hour earlier, was on.
    expect(visibleOnShift([row({ endsAt: EARLIER })], new Date("2026-10-07T16:00:00Z"))).toEqual(["Alex M."]);
  });

  it("drops somebody who may not hold a shift (a student, a demoted or banned account)", () => {
    expect(visibleOnShift([row({ eligible: false })], NOW)).toEqual([]);
  });

  it("drops a placeholder name (the address) rather than showing an address or inventing a name", () => {
    expect(visibleOnShift([row({ name: "alex@cornell.edu" })], NOW)).toEqual([]);
    expect(visibleOnShift([row({ name: "" }), row({ name: null })], NOW)).toEqual([]);
  });

  it("lists everybody on shift once, alphabetically, and leaves out the rest", () => {
    const rows = [
      row({ name: "Jordan Park" }),
      row({ name: "Alex Morgan" }),
      row({ name: "Alex Mendes" }), // the same short name once
      row({ name: "Sam Lee", endsAt: EARLIER }),
      row({ name: "Casey Student", eligible: false }),
    ];
    expect(visibleOnShift(rows, NOW)).toEqual(["Alex M.", "Jordan P."]);
  });

  it("takes Date end times as well as text", () => {
    expect(visibleOnShift([row({ endsAt: new Date(LATER) })], NOW)).toEqual(["Alex M."]);
  });
});

describe("shiftDisplayName", () => {
  it.each([
    ["Alex Morgan", "Alex M."],
    ["Luis Rodrigo Navarro", "Luis N."],
    ["Niti", "Niti"],
    ["  jordan   park ", "jordan P."],
  ])("shows %j as %j", (name, shown) => {
    expect(shiftDisplayName(name)).toBe(shown);
  });

  it("shows nothing for an address or an empty name", () => {
    expect(shiftDisplayName("niti@cornell.edu")).toBeNull();
    expect(shiftDisplayName("")).toBeNull();
    expect(shiftDisplayName(null)).toBeNull();
  });
});
