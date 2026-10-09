import { isPlaceholderItemName, itemNameProblem, nameWords } from "./item-name";

/**
 * The "no empty items" rule (data platform spec amendment "No empty items"):
 * a pending item's name must have one specific word.
 */
describe("itemNameProblem", () => {
  it("refuses an empty or whitespace name as empty", () => {
    for (const name of ["", "   ", "\n\t", null, undefined]) expect(itemNameProblem(name)).toBe("empty");
  });

  it("refuses the placeholder the assistant wrote, and its relatives, whatever the case and punctuation", () => {
    for (const name of [
      "Equipment not specified",
      "equipment NOT specified.",
      "Unknown",
      "unknown item",
      "Item",
      "Tool",
      "Tools",
      "N/A",
      "n.a.",
      "TBD",
      "To be determined",
      "Untitled",
      "Untitled item 3",
      "New equipment",
      "New item",
      "Unspecified device",
      "Unidentified machine",
      "Item #1",
      "Tool 2",
      "Model not visible",
      "No name",
      "Not sure",
      "???",
      "—",
      "Misc. stuff",
      "Placeholder",
      "I'd like to add new equipment to the inventory.",
      "Équipement non spécifié",
      "Equipo desconocido",
      "A",
      "123",
    ]) {
      expect({ name, problem: itemNameProblem(name) }).toEqual({ name, problem: "placeholder" });
    }
  });

  it("accepts any name with one specific word — a make, a model or a plain description", () => {
    for (const name of [
      "Bambu Lab X1-Carbon Combo",
      "Cordless drill, brand not visible",
      "Filament 3D printer, model not visible",
      "3D printer",
      "Makita",
      "Dremel 3000",
      "Prusa MK4S",
      "iPad 6th generation",
      "Ryobi batteries",
      "Sewing machine",
      "Shop vac",
      "X2D",
      "Glowforge Pro",
      "Unknown brand soldering station",
      "锯",
    ]) {
      expect({ name, problem: itemNameProblem(name) }).toEqual({ name, problem: null });
    }
  });

  it("isPlaceholderItemName is the same rule as a boolean", () => {
    expect(isPlaceholderItemName("Equipment not specified")).toBe(true);
    expect(isPlaceholderItemName("  ")).toBe(true);
    expect(isPlaceholderItemName("Formlabs Form 4")).toBe(false);
  });

  it("splits on punctuation and drops accents", () => {
    expect(nameWords("Équipement — non-spécifié (N/A)")).toEqual(["equipement", "non", "specifie", "n", "a"]);
  });
});
