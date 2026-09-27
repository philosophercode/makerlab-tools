import { describe, expect, it } from "vitest";
import { brandLabel, categoryNoun, isBareBrand } from "./tool-name-brand";
import { baseDisplayName, distinctDisplayName, insertSpec, resolveDisplayNames, type BatchCandidate } from "./tool-name-choice";

/**
 * Display names amendment 2026-09-25: a display name says what the item is
 * (never a bare brand), and no two tools share one — a collision keeps the
 * attribute that tells them apart. The cases are the real inventory's, from
 * the dry run that found both problems.
 */

describe("isBareBrand — the guard refuses a name that is only a brand", () => {
  it.each([
    ["Hakko", "HAKKO FX-888D"],
    ["Makita", "MAKITA RT0701C"],
    ["Weller", "Weller WESD51"],
    ["Bofa", "Bofa AD500 Fume Extractor"],
    ["Aoyue Int", "AOYUE Int 2703A+"],
    ["Bambu Lab", "Bambu Lab X2D 3D Printer"],
    ["Ryobi ONE+", "RYOBI ONE+ 18V Lithium-Ion 4 Ah Battery PBP004"],
    ["Spear & Jackson", "SPEAR & JACKSON Traditional Brass Back Tenon Saw 9550B"],
  ])("%j (from %j) is only a brand", (display, sourceName) => {
    expect(isBareBrand(display, { sourceName })).toBe(true);
  });

  it.each([
    ["Dremel 3000", "Dremel 3000"],
    ["Form 4", "Form 4"],
    ["X2D", "Bambu Lab X2D 3D Printer"],
    ["Speedy 400", "Trotec Speedy 400, 80w"],
    ["Othermill Pro", "Bantam Desktop PCB Milling Machine (Othermill Pro)"],
    ["BladeRunner X2", "Rockwell BladeRunner X2 (RK7323)"],
    ["Sparrow X2", "EverSewn Sparrow X2 Sewing & Embroidery Machine"],
    ["HP Sprout", "HP Sprout (J4W72AA#ABA)"],
    ["iPad 6th generation", "iPad 6th generation [MR7F2LL./A]"],
    ["Hakko Soldering Station", "HAKKO FX-888D"],
    ["Ryobi ONE+ Battery", "RYOBI ONE+ 18V Lithium-Ion 4 Ah Battery PBP004"],
    ["WEN Dust Collector", "WEN Woodworking Dust Collector (DC3401)"],
  ])("%j (from %j) says what the item is", (display, sourceName) => {
    expect(isBareBrand(display, { sourceName })).toBe(false);
  });

  it("a one-word noun that the category names is not taken for a brand", () => {
    expect(isBareBrand("Oscilloscope", { sourceName: "Oscilloscope Textronix", category: "Oscilloscope" })).toBe(false);
  });
});

describe("brandLabel / categoryNoun", () => {
  it("spells the brand the way a card would", () => {
    expect(brandLabel("HAKKO FX-888D")).toBe("Hakko");
    expect(brandLabel("AOYUE Int 2703A+")).toBe("Aoyue");
    expect(brandLabel("Weller WESD51")).toBe("Weller");
    expect(brandLabel("WEN Woodworking Dust Collector")).toBe("WEN");
    expect(brandLabel("RYOBI ONE+ 18V Battery")).toBe("Ryobi ONE+");
  });

  it("turns a category into the thing a tool in it is", () => {
    expect(categoryNoun("Soldering")).toBe("Soldering Station");
    expect(categoryNoun("Router")).toBe("Router");
    expect(categoryNoun("Rework Station")).toBe("Rework Station");
    expect(categoryNoun("Drill/Driver")).toBe("Drill");
    expect(categoryNoun("Fume Extraction")).toBe("Fume Extractor");
    expect(categoryNoun("Accessory")).toBeNull();
    expect(categoryNoun("Post-Processing")).toBeNull();
    expect(categoryNoun(null)).toBeNull();
  });
});

describe("baseDisplayName — never a bare brand", () => {
  it.each([
    // The model answered with the brand alone; the guarded long name keeps the noun.
    ["Bofa", "Bofa AD500 Fume Extractor", "Fume Extraction", "Bofa Fume Extractor"],
    // Nothing but a brand and a code: the brand plus the category's noun.
    ["Hakko", "HAKKO FX-888D", "Soldering", "Hakko Soldering Station"],
    ["Makita", "MAKITA RT0701C", "Router", "Makita Router"],
    ["Weller", "Weller WESD51", "Soldering", "Weller Soldering Station"],
    ["Aoyue Int", "AOYUE Int 2703A+", "Rework Station", "Aoyue Rework Station"],
    // The model's own type noun wins when it gives one.
    ["Makita Compact Router", "MAKITA RT0701C", "Router", "Makita Compact Router"],
  ])("%j for %j → %j", (answer, sourceName, category, expected) => {
    expect(baseDisplayName({ answer, sourceName, category })).toBe(expected);
  });

  it("keeps the old name (empty) rather than write a bare brand when the category names no thing", () => {
    expect(baseDisplayName({ answer: "Hakko", sourceName: "HAKKO FX-888D", category: "Accessory" })).toBe("");
  });

  it.each([
    ["Dremel 3000", "Dremel 3000"],
    ["Formlabs Form 4", "Formlabs Form 4 Resin 3D Printer"],
    ["Bambu Lab X2D", "Bambu Lab X2D 3D Printer"],
    ["Trotec Speedy 400", "Trotec Speedy 400, 80w"],
    ["Othermill Pro", "Bantam Desktop PCB Milling Machine (Othermill Pro)"],
    ["Rockwell BladeRunner X2", "Rockwell BladeRunner X2 (RK7323)"],
    ["EverSewn Sparrow X2", "EverSewn Sparrow X2 Sewing & Embroidery Machine"],
  ])("keeps the model line people say: %j", (answer, sourceName) => {
    expect(baseDisplayName({ answer, sourceName })).toBe(answer);
  });

  it.each([
    ["Stanley Mini Utility Saw", "STANLEY 20-221 10-Inch 12 Points Per Inch SharpTooth Mini Utility Saw"],
    ["WEN Dust Collector", "WEN Woodworking Dust Collector (DC3401)"],
    ["Othermill Pro", "Bantam Desktop PCB Milling Machine (Othermill Pro)"],
    ["ShopBot Buddy BT48", "Shopbot Buddy BT48[L36” x W76” x H67”]"],
    ["Trotec Speedy 400", "Trotec Speedy 400, 80w"],
    ["Festool CT Midi Dust Extractor", "Festool 575267 Dust Extractor CT Midi Hepa"],
    ["Spear & Jackson Tenon Saw", "SPEAR & JACKSON Traditional Brass Back Tenon Saw 9550B"],
    ["iPad 6th generation", "iPad 6th generation [MR7F2LL./A]"],
    ["HP Sprout", "HP Sprout (J4W72AA#ABA)"],
  ])("regression: the dry run's good answer %j stands", (answer, sourceName) => {
    expect(baseDisplayName({ answer, sourceName })).toBe(answer);
  });
});

describe("uniqueness — a collision keeps what tells the tools apart", () => {
  const batteries: BatchCandidate[] = [
    ["a", "RYOBI ONE+ 18V Lithium-Ion 1.5 Ah Battery PBP002"],
    ["b", "RYOBI ONE+ 18V Lithium-Ion 3.0 Ah Battery P103"],
    ["c", "RYOBI ONE+ 18V Lithium-Ion 4 Ah Battery PBP004"],
  ].map(([id, sourceName]) => ({ id, currentName: sourceName, sourceName, answer: "Ryobi ONE+ Battery", category: "Accessory" }));

  it("three batteries that shorten to one name each keep their capacity — all three, not two", () => {
    const choices = resolveDisplayNames(batteries, ["Form 4"]);
    expect([...choices.values()]).toEqual([
      { name: "Ryobi ONE+ 1.5Ah Battery" },
      { name: "Ryobi ONE+ 3Ah Battery" },
      { name: "Ryobi ONE+ 4Ah Battery" },
    ]);
  });

  it("takes the model's own distinguishing answer when the long name has no spec to add", () => {
    const choices = resolveDisplayNames(
      [
        { id: "a", currentName: "Makita Battery BL1850B", sourceName: "Makita Battery BL1850B", answer: "Makita 5Ah Battery" },
        { id: "b", currentName: "Makita Battery BL1830B", sourceName: "Makita Battery BL1830B", answer: "Makita 3Ah Battery" },
      ],
      []
    );
    // Plain, both are "Makita Battery"; the part numbers carry no capacity, the answers do.
    expect([...choices.values()]).toEqual([{ name: "Makita 5Ah Battery" }, { name: "Makita 3Ah Battery" }]);
  });

  it("a name another tool outside the batch already has is distinguished, or refused", () => {
    const [one] = batteries;
    expect(resolveDisplayNames([one], ["Ryobi ONE+ Battery"]).get("a")).toEqual({ name: "Ryobi ONE+ 1.5Ah Battery" });
    const plain = { id: "x", currentName: "Makita 196094-2 Plunge Base", sourceName: "Makita 196094-2 Plunge Base", answer: "Makita Plunge Base" };
    expect(resolveDisplayNames([plain], ["makita plunge-base"]).get("x")).toEqual({ name: null, reason: "duplicate_name" });
  });

  it("two identical tools: the first takes the name, the second keeps its old one rather than repeat it", () => {
    const twin = (id: string): BatchCandidate => ({
      id,
      currentName: `Makita 196094-2 Plunge Base (${id})`,
      sourceName: "Makita 196094-2 Plunge Base",
      answer: "Makita Plunge Base",
    });
    const choices = resolveDisplayNames([twin("a"), twin("b")], []);
    expect(choices.get("a")).toEqual({ name: "Makita Plunge Base" });
    expect(choices.get("b")).toEqual({ name: null, reason: "duplicate_name" });
  });

  it("a member whose answer an earlier one took falls back to its own long name (the real Stanley saws)", () => {
    const saw = (id: string, sourceName: string): BatchCandidate => ({
      id,
      currentName: sourceName,
      sourceName,
      answer: "Stanley SharpTooth Hand Saw",
      category: "Hand Saw",
    });
    const choices = resolveDisplayNames(
      [saw("a", "STANLEY Saw 15-206"), saw("b", "STANLEY SharpTooth Heavy Duty Saw 15-087")],
      []
    );
    expect(choices.get("a")).toEqual({ name: "Stanley SharpTooth Hand Saw" });
    expect(choices.get("b")).toEqual({ name: "Stanley SharpTooth Heavy Duty Saw" });
  });

  it("no usable name at all is no_name, not a duplicate", () => {
    expect(resolveDisplayNames([{ id: "z", currentName: "575267", sourceName: "575267", answer: null }], []).get("z")).toEqual({
      name: null,
      reason: "no_name",
    });
  });

  it("distinctDisplayName: one tool against the rest, as refresh and the intake page use it", () => {
    const candidate = { answer: "Ryobi ONE+ Battery", sourceName: "RYOBI ONE+ 18V Lithium-Ion 2 Ah Battery" };
    expect(distinctDisplayName(candidate, ["Ryobi ONE+ 1.5Ah Battery", "Ryobi ONE+ 4Ah Battery"])).toBe("Ryobi ONE+ 2Ah Battery");
    expect(distinctDisplayName(candidate, ["Form 4"])).toBe("Ryobi ONE+ Battery");
    expect(distinctDisplayName({ answer: "Form 4", sourceName: "Formlabs Form 4" }, ["FORM 4"])).toBe("");
  });

  it("insertSpec puts the attribute before the noun", () => {
    expect(insertSpec("Ryobi ONE+ Battery", "4Ah")).toBe("Ryobi ONE+ 4Ah Battery");
    expect(insertSpec("Battery", "4Ah")).toBe("Battery 4Ah");
  });
});
