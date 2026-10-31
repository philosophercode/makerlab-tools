import type { RankedImage } from "../research/images/rank";
import type { ImageHint } from "../web/read-page";
import { brandFromLinks, photoCandidates, photoSearchInstruction, PHOTO_PREFERENCE, toPhotoOption } from "./candidates";
import { parsePhotoOptions, photoOptionHost, photoSearchRunning, PHOTO_SEARCH_STALE_MS } from "./types";

/** The pure half of a photo options search (photo options spec 2026-10-29 §3.1). */

function hint(url: string, pageUrl: string | null, source: ImageHint["source"] = "og"): ImageHint {
  return { url, pageUrl, source } as ImageHint;
}

describe("brandFromLinks", () => {
  it("takes the name's first word when one of the tool's links is on the brand's host", () => {
    expect(brandFromLinks("Prusa MK4S", ["https://www.prusa3d.com/product/original-prusa-mk4s/"])).toBe("Prusa");
  });

  it("takes two words when the brand is two words", () => {
    expect(brandFromLinks("Bambu Lab X1 Carbon", ["https://bambulab.com/en/x1"])).toBe("Bambu Lab");
  });

  it("guesses nothing from the name alone, or from a shop's host", () => {
    expect(brandFromLinks("Prusa MK4S", [])).toBeNull();
    expect(brandFromLinks("Sewing machine", ["https://www.amazon.com/dp/B000"])).toBeNull();
    expect(brandFromLinks("Glowforge", ["https://glowforge.com"])).toBeNull();
  });
});

describe("photoCandidates", () => {
  const subject = { brand: "Prusa", name: "Prusa MK4S" };

  it("leaves out pictures already offered and the current cover's source", () => {
    const shown = "https://cdn.example/a.png";
    const cover = "https://cdn.example/cover.jpg";
    const fresh = "https://cdn.example/b.png";
    const out = photoCandidates([hint(shown, "https://shop.example/p"), hint(cover, null, "exa")], [hint(fresh, null, "exa")], {
      exclude: [shown, `${cover}#x`],
      subject,
    });
    expect(out.map((h) => h.url)).toEqual([fresh]);
  });

  it("puts the maker's product page pictures before a shop's", () => {
    const out = photoCandidates(
      [hint("https://shop.example/img/mk4.jpg", "https://shop.example/prusa-mk4s")],
      [hint("https://www.prusa3d.com/img/mk4s.png", "https://www.prusa3d.com/product/prusa-mk4s/", "exa")],
      { exclude: [], subject }
    );
    expect(out[0].url).toBe("https://www.prusa3d.com/img/mk4s.png");
  });
});

describe("photoSearchInstruction", () => {
  it("always carries the house preference, and the person's note after it", () => {
    expect(photoSearchInstruction(null)).toBe(PHOTO_PREFERENCE);
    expect(photoSearchInstruction("the white one")).toBe(`${PHOTO_PREFERENCE} The staff member adds: the white one`);
    expect(PHOTO_PREFERENCE).toMatch(/manufacturer/);
    expect(PHOTO_PREFERENCE).toMatch(/retailer/);
  });
});

describe("toPhotoOption and parsePhotoOptions", () => {
  const ranked = {
    manufacturer: true,
    candidate: {
      url: "https://www.prusa3d.com/img/mk4s.png",
      pageUrl: "https://www.prusa3d.com/product/prusa-mk4s/",
      source: "og",
      width: 1200,
      height: 900,
      contentType: "image/png",
      rank: 1,
      reason: "the whole printer from the front",
      background: "plain",
      view: "front",
    },
  } as unknown as RankedImage;

  it("stores what the editor shows and a pick needs, and reads it back", () => {
    const option = toPhotoOption(ranked);
    expect(option).toEqual({
      url: "https://www.prusa3d.com/img/mk4s.png",
      pageUrl: "https://www.prusa3d.com/product/prusa-mk4s/",
      source: "og",
      width: 1200,
      height: 900,
      contentType: "image/png",
      reason: "the whole printer from the front",
      background: "plain",
      view: "front",
      manufacturer: true,
    });
    expect(parsePhotoOptions([option, { url: "not a url" }, null])).toEqual([option]);
    expect(parsePhotoOptions("nope")).toEqual([]);
    expect(photoOptionHost(option)).toBe("prusa3d.com");
  });
});

describe("photoSearchRunning", () => {
  it("is true only for a fresh searching row", () => {
    const now = Date.now();
    expect(photoSearchRunning({ status: "searching", createdAt: new Date(now - 1000) }, now)).toBe(true);
    expect(photoSearchRunning({ status: "searching", createdAt: new Date(now - PHOTO_SEARCH_STALE_MS - 1) }, now)).toBe(false);
    expect(photoSearchRunning({ status: "ready", createdAt: new Date(now) }, now)).toBe(false);
  });
});
