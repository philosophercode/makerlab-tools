import { describe, expect, it } from "vitest";
import {
  cleanDisplayName,
  cleanOfficialName,
  DISPLAY_NAME_MAX,
  displayNameFrom,
  displayNameProblems,
  isValidDisplayName,
  lookupName,
  looksLikePartNumber,
  officialNameShown,
} from "./tool-names";

/** Tool display names spec 2026-09-24, §5.1 — the rules, in code. */

describe("looksLikePartNumber", () => {
  it.each(["196094-2", "575267", "20-221", "96289)", "DCB107", "P593", "MR7F2LL", "#1234", "DC-3401", "PCL235"])(
    "%s is a code",
    (token) => {
      expect(looksLikePartNumber(token)).toBe(true);
    }
  );

  it.each(["Form", "4", "X2D", "MK4", "MK4S", "400", "X1-Carbon", "S5", "BT48", "A1", "3D", "6th", "i3", "ONE+"])(
    "%s is a name, not a code",
    (token) => {
      expect(looksLikePartNumber(token)).toBe(false);
    }
  );
});

describe("cleanDisplayName — the guard", () => {
  it.each([
    ["Form 4", "Form 4"],
    ["Bambu Lab X2D", "Bambu Lab X2D"],
    ["Trotec Speedy 400", "Trotec Speedy 400"],
    ["Original Prusa MK4S", "Original Prusa MK4S"],
    ["Bambu Lab X1-Carbon Combo", "Bambu Lab X1-Carbon Combo"],
    ["Othermill Pro", "Othermill Pro"],
    ["MAKITA Plunge Base", "MAKITA Plunge Base"],
    ["Bambu Lab X2D 3D Printer", "Bambu Lab X2D 3D Printer"],
  ])("leaves %j exactly as it is", (raw, clean) => {
    expect(cleanDisplayName(raw)).toBe(clean);
    expect(displayNameProblems(raw)).toEqual([]);
  });

  it.each([
    ["Makita 196094-2 Compact Router Plunge Base", "Makita Compact Router Plunge Base"],
    ["Festool 575267 Dust Extractor CT Midi Hepa", "Festool Dust Extractor CT Midi Hepa"],
    ["iPad 6th generation [MR7F2LL./A]", "iPad 6th generation"],
    ["Shopbot Buddy BT48[L36” x W76” x H67”]", "Shopbot Buddy BT48"],
    ["DRILL MASTER 1500 Watt Dual-Temperature Heat Gun (Model 96289)", "DRILL MASTER Dual-Temperature Heat Gun"],
    ["STANLEY 20-221 10-Inch 12 Points Per Inch SharpTooth Mini Utility Saw", "STANLEY SharpTooth Mini Utility Saw"],
    ["DEWALT DCB107 12V/20V MAX Lithium Ion Charger", "DEWALT MAX Lithium Ion Charger"],
    ['3/8" Drill Bit Set', "Drill Bit Set"],
  ])("strips the codes, brackets and specs from %j", (raw, clean) => {
    expect(cleanDisplayName(raw)).toBe(clean);
  });

  it("keeps a parenthesis that is a name, not a code", () => {
    expect(cleanDisplayName("Desktop Mill (Othermill Pro)")).toBe("Desktop Mill (Othermill Pro)");
  });

  it("cuts at a word boundary to the cap and never ends on a connector", () => {
    const cut = cleanDisplayName("RYOBI P593 18-Volt ONE+ Lithium Ion Cordless PVC and Pex Cutter");
    expect(cut).toBe("RYOBI ONE+ Lithium Ion Cordless PVC");
    expect(cut.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    const long = cleanDisplayName("Hi-Spec 16 Piece Metal Hand & Needle Files Tool Set Kit");
    expect(long.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    expect(long).not.toMatch(/(?:&|and)$/);
  });

  it("only ever removes words — never adds one", () => {
    for (const raw of ["Makita 196094-2 Compact Router Plunge Base", "WEN DC3401", "Form 4"]) {
      const words = new Set(raw.split(/\s+/));
      for (const word of cleanDisplayName(raw).split(/\s+/)) expect(words.has(word)).toBe(true);
    }
  });

  it("answers empty for nothing, and for a name that is only codes", () => {
    expect(cleanDisplayName("")).toBe("");
    expect(cleanDisplayName(null)).toBe("");
    expect(cleanDisplayName("196094-2")).toBe("");
  });
});

describe("displayNameProblems", () => {
  it("names each problem, and style is not one", () => {
    expect(displayNameProblems("")).toEqual(["empty"]);
    expect(displayNameProblems("Festool 575267 Dust Extractor CT Midi Hepa")).toEqual(["part_number", "too_long"]);
    expect(displayNameProblems("iPad 6th generation [MR7F2LL./A]")).toEqual(["bracket"]);
    expect(displayNameProblems("Hi-Spec 16 Piece Metal Hand & Needle Files Tool Set Kit")).toEqual(["spec", "too_long"]);
    expect(isValidDisplayName("MAKITA Plunge Base")).toBe(true);
    expect(isValidDisplayName("x".repeat(DISPLAY_NAME_MAX + 1))).toBe(false);
  });
});

describe("displayNameFrom", () => {
  it("takes the model's answer through the guard", () => {
    expect(displayNameFrom({ displayName: "Makita Plunge Base", officialName: "Makita 196094-2 …", fallback: "x" })).toBe(
      "Makita Plunge Base"
    );
    expect(displayNameFrom({ displayName: "Makita 196094-2 Plunge Base", fallback: "x" })).toBe("Makita Plunge Base");
  });

  it("falls back to the official name, preferring more than a bare brand", () => {
    expect(displayNameFrom({ displayName: "", officialName: "Formlabs Form 4", fallback: "Form 4" })).toBe("Formlabs Form 4");
    // "WEN DC3401" guarded is just "WEN": the fallback that keeps two words wins when there is one.
    expect(displayNameFrom({ officialName: "WEN DC3401", fallback: "WEN Air Filter" })).toBe("WEN Air Filter");
    // With nothing better, a bare word — never a part number on a card.
    expect(displayNameFrom({ officialName: "WEN DC3401", fallback: "WEN DC3401" })).toBe("WEN");
  });

  it("always gives a name for a name", () => {
    expect(displayNameFrom({ fallback: "196094-2" })).toBe("196094-2");
  });
});

describe("officialNameShown / lookupName / cleanOfficialName", () => {
  it("shows the official name only when it says more than the display name", () => {
    expect(officialNameShown({ name: "Makita Plunge Base", officialName: "Makita 196094-2 Compact Router Plunge Base" })).toBe(
      "Makita 196094-2 Compact Router Plunge Base"
    );
    expect(officialNameShown({ name: "Form 4", officialName: "FORM-4" })).toBeNull();
    expect(officialNameShown({ name: "Form 4", officialName: "  " })).toBeNull();
    expect(officialNameShown({ name: "Form 4" })).toBeNull();
  });

  it("looks a tool up by its official name when it has one", () => {
    expect(lookupName({ name: "Makita Plunge Base", officialName: "Makita 196094-2 Compact Router Plunge Base" })).toBe(
      "Makita 196094-2 Compact Router Plunge Base"
    );
    expect(lookupName({ name: "Form 4", officialName: null })).toBe("Form 4");
  });

  it("stores an official name trimmed, on one line, or none", () => {
    expect(cleanOfficialName("  Makita\n196094-2  ")).toBe("Makita 196094-2");
    expect(cleanOfficialName("")).toBeNull();
    expect(cleanOfficialName("x".repeat(300))).toHaveLength(200);
  });
});
