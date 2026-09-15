import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lower-cases, replaces runs of punctuation and spaces with one dash, and trims", () => {
    expect(slugify("Trotec Speedy 400, 80w")).toBe("trotec-speedy-400-80w");
    expect(slugify("  Form 4  ")).toBe("form-4");
    expect(slugify("Bambu Lab X1-Carbon Combo")).toBe("bambu-lab-x1-carbon-combo");
  });

  it("strips accents and non-ASCII letters", () => {
    expect(slugify("Découpeuse laser")).toBe("decoupeuse-laser");
  });

  it("never returns an empty slug", () => {
    expect(slugify("")).toBe("item");
    expect(slugify("///")).toBe("item");
  });

  it("caps the length without ending on a dash", () => {
    const long = slugify("a ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the base when free and reserves it", () => {
    const taken = new Set<string>();
    expect(uniqueSlug("form-4", taken)).toBe("form-4");
    expect(taken.has("form-4")).toBe(true);
  });

  it("suffixes from 2 upward on collisions", () => {
    const taken = new Set(["form-4", "form-4-2"]);
    expect(uniqueSlug("form-4", taken)).toBe("form-4-3");
    expect(uniqueSlug("form-4", taken)).toBe("form-4-4");
  });
});
