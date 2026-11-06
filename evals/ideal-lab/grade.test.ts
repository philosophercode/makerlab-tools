import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StageCache, hashOf, sourceFingerprint, withCostMeter } from "./cache";
import { IDEAL_LAB_CASES, LAB_ZONES, namesTheModel } from "./cases";
import {
  formatReport,
  handGradeSheet,
  isGoodListing,
  loopPass,
  newIsAFor,
  parseGolden,
  parseListingVerdict,
  parsePairwise,
  pickJudgePromptWithSource,
  readHandGrades,
  regressions,
  summarize,
  type CaseResult,
  type ListingVerdict,
} from "./grade";

const GOOD: ListingVerdict = {
  rightMachine: "yes",
  accuracy: 5,
  grounded: 4,
  unsupported: [],
  description: 5,
  specs: 4,
  keywords: 4,
  safety: 5,
  nameOk: true,
  reason: "none",
};

function passing(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
    model: "Bambu Lab H2D",
    holdout: false,
    identifiedName: "Bambu Lab H2D",
    checks: {
      identifiedOne: true,
      identifiedRight: true,
      english: true,
      manualFound: true,
      manualIsPdf: true,
      linksResolve: true,
      citationCoverage: 1,
      descriptionWords: 55,
      imageChosen: true,
      zoneRight: true,
      makerPhoto: true,
    },
    listing: GOOD,
    listingForJudge: {
      model: "Bambu Lab H2D",
      displayName: "Bambu Lab H2D",
      officialName: "Bambu Lab H2D",
      description: "A dual-nozzle printer.",
      specs: [{ label: "Build volume", value: "325 × 320 × 325 mm" }],
      tags: "fdm, 3d printing",
      materials: "PLA",
      ppeRequired: "",
      useRestrictions: "",
      zone: "3D Printing Hub",
      resources: [],
      sources: [],
    },
    top: [{ url: "https://bambulab.com/h2d.png", host: "bambulab.com", verdict: { rightModel: "yes", plainBackground: true, retailScene: false, reason: "ok" } }],
    cutout: { kind: "judged", cleaned: "cut", verdict: { edges: "clean", productIntact: true, backgroundLeft: false, reason: "ok" } },
    cost: { pipeline: 0.2, pipelineFresh: 0.1, judge: 0.05 },
    cached: { identify: true, research: false, image: false },
    seconds: 30,
    ...overrides,
  };
}

describe("ideal-lab cases", () => {
  it("has ten tuned cases and three held out, with unique ids and real zones", () => {
    expect(IDEAL_LAB_CASES.filter((testCase) => !testCase.holdout)).toHaveLength(10);
    expect(IDEAL_LAB_CASES.filter((testCase) => testCase.holdout)).toHaveLength(3);
    expect(new Set(IDEAL_LAB_CASES.map((testCase) => testCase.id)).size).toBe(IDEAL_LAB_CASES.length);
    const zones = new Set<string>(LAB_ZONES.map((zone) => zone.zone));
    for (const testCase of IDEAL_LAB_CASES) {
      if (testCase.zone !== null) expect(zones.has(testCase.zone), testCase.id).toBe(true);
      expect(namesTheModel(testCase.model, testCase), testCase.id).toBe(true);
    }
  });

  it("matches model tokens ignoring case, spaces and dashes", () => {
    expect(namesTheModel("Hakko FX 888DX", { mustName: ["FX-888DX"] })).toBe(true);
    expect(namesTheModel("Hakko FX-888D", { mustName: ["FX-888DX"] })).toBe(false);
  });
});

describe("ideal-lab verdicts", () => {
  it("reads the listing judge and requires every score", () => {
    const verdict = parseListingVerdict(
      'Here: {"right_machine":"yes","accuracy":5,"grounded":4,"unsupported":["IP rating"],"description":3,"specs":4,"keywords":4,"safety":5,"name_ok":true,"reason":"too short"}'
    );
    expect(verdict).toMatchObject({ description: 3, unsupported: ["IP rating"] });
    expect(isGoodListing(verdict!)).toBe(false);
    expect(parseListingVerdict('{"right_machine":"yes","accuracy":5}')).toBeNull();
    expect(parseListingVerdict('{"right_machine":"yes","accuracy":6,"grounded":4,"description":4,"specs":4,"keywords":4,"safety":4,"name_ok":true}')).toBeNull();
  });

  it("reads pairwise verdicts from the new run's side, whichever slot it was in", () => {
    expect(parsePairwise('{"winner":"A","reason":"r"}', true)?.outcome).toBe("better");
    expect(parsePairwise('{"winner":"A","reason":"r"}', false)?.outcome).toBe("worse");
    expect(parsePairwise('{"winner":"tie","reason":"r"}', false)?.outcome).toBe("same");
    expect(parsePairwise('{"winner":"C"}', true)).toBeNull();
    const slots = IDEAL_LAB_CASES.map((testCase) => newIsAFor(testCase.id));
    expect(slots.some(Boolean) && slots.some((slot) => !slot)).toBe(true);
  });

  it("tells the photo judge where the picture came from, for look-alike models", () => {
    const prompt = pickJudgePromptWithSource("Universal Robots UR5e", {
      url: "https://www.universal-robots.com/media/ur5e.png",
      pageUrl: "https://www.universal-robots.com/products/ur5e/",
      makerHosts: ["universal-robots.com"],
    });
    expect(prompt).toContain("The page it was on: https://www.universal-robots.com/products/ur5e/");
    expect(prompt).toContain("The maker's own sites: universal-robots.com");
    expect(pickJudgePromptWithSource("X", { url: "https://a.example/x.png", pageUrl: null, makerHosts: [] })).toContain("(not known)");
  });

  it("reads a golden listing", () => {
    const golden = parseGolden(
      '{"display_name":"Bambu Lab H2D","official_name":"Bambu Lab H2D","description":"d","specs":[{"label":"Build volume","value":"325 mm"},{"bad":1}],"tags":["fdm",""],"materials":[],"ppe_required":[],"use_restrictions":null,"manual_url":"not a url","sources":["https://bambulab.com"]}'
    );
    expect(golden).toMatchObject({ displayName: "Bambu Lab H2D", specs: [{ label: "Build volume", value: "325 mm" }], tags: ["fdm"], manualUrl: null });
    expect(parseGolden('{"display_name":"x"}')).toBeNull();
  });
});

describe("ideal-lab scores", () => {
  it("passes the loop only when every stage is good", () => {
    expect(loopPass(passing("a"))).toBe(true);
    expect(loopPass(passing("a", { checks: { ...passing("a").checks!, zoneRight: false } }))).toBe(false);
    expect(loopPass(passing("a", { cutout: { kind: "as_is", note: "busy_background" } }))).toBe(false);
    // A transparent original needs no cutout.
    expect(loopPass(passing("a", { cutout: { kind: "as_is", note: null } }))).toBe(true);
    expect(loopPass(passing("a", { listing: { ...GOOD, nameOk: false } }))).toBe(false);
  });

  it("scores tuned and held-out cases apart, and counts what the run paid", () => {
    const summary = summarize([passing("a"), passing("b", { listing: null }), passing("c", { holdout: true })]);
    expect(summary.tuned.cases).toBe(2);
    expect(summary.tuned.loopPass).toBe(0.5);
    expect(summary.holdout.loopPass).toBe(1);
    expect(summary.cost.total).toBeCloseTo(0.45);
  });

  it("flags a guarded score that fell past its tolerance", () => {
    const ten = (fails: number) => Array.from({ length: 10 }, (_, index) => passing(`c${index}`, index < fails ? { listing: null } : {}));
    const baseline = summarize(ten(0));
    expect(regressions(summarize(ten(1)), baseline)).toEqual([]);
    expect(regressions(summarize(ten(2)), baseline).map((entry) => entry.label)).toEqual(["Loop pass", "Listing good"]);
  });

  it("writes a report and a hand-grading sheet that reads back", () => {
    const results = [passing("bambu-h2d")];
    expect(formatReport(results, summarize(results), null)).toContain("✓ bambu-h2d");
    const sheet = handGradeSheet(results, "run");
    const ticked = sheet.replace("- [ ] agree (listing)", "- [x] agree (listing)").replace("- [ ] disagree (photo)", "- [x] disagree (photo)");
    expect(readHandGrades(ticked)).toEqual([
      { id: "bambu-h2d", part: "listing", agree: true },
      { id: "bambu-h2d", part: "photo", agree: false },
    ]);
  });
});

describe("ideal-lab cache", () => {
  it("keeps a stage's output under its key, and ignores it when fresh", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "il-cache-"));
    await new StageCache(dir, false).put("research", "case", "k1", { a: 1 });
    expect(await new StageCache(dir, false).get("research", "case", "k1")).toEqual({ a: 1 });
    expect(await new StageCache(dir, false).get("research", "case", "k2")).toBeNull();
    expect(await new StageCache(dir, true).get("research", "case", "k1")).toBeNull();
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
  });

  it("fingerprints source files, so an edit changes the key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "il-src-"));
    await writeFile(path.join(dir, "a.ts"), "one");
    await writeFile(path.join(dir, "a.test.ts"), "ignored");
    const before = await sourceFingerprint(dir, ["."]);
    await writeFile(path.join(dir, "a.test.ts"), "still ignored");
    expect(await sourceFingerprint(dir, ["."])).toBe(before);
    await writeFile(path.join(dir, "a.ts"), "two");
    expect(await sourceFingerprint(dir, ["."])).not.toBe(before);
  });

  it("sums the costs research logs while a stage runs", async () => {
    const { value, cost } = await withCostMeter(async () => {
      console.info("[research] r: search call cost $0.0120, tier flex");
      console.info("[research] r: read call cost not reported, tier flex");
      console.info("[research] image rank call cost $0.0030, tier flex");
      console.info("[research] image rank call cost $0.0000 (own key, list price $0.0100), tier not reported");
      return 7;
    });
    expect(value).toBe(7);
    expect(cost).toBeCloseTo(0.025);
  });
});
