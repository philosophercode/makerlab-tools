import { PHOTO_EVAL_CASES } from "./cases";
import {
  formatReport,
  isCleanCutout,
  isGoodPick,
  onMakerHost,
  parseCutoutVerdict,
  parsePickVerdict,
  summarize,
  type CaseResult,
  type PickVerdict,
} from "./grade";

const good: PickVerdict = {
  rightModel: "yes",
  plainBackground: true,
  retailScene: false,
  reason: "The printer on white.",
};
const busy: PickVerdict = {
  rightModel: "yes",
  plainBackground: false,
  retailScene: true,
  reason: "On a store shelf.",
};

function result(over: Partial<CaseResult>): CaseResult {
  return {
    name: "Formlabs Form 4",
    optionCount: 6,
    makerPhoto: true,
    top: [],
    cutout: null,
    seconds: 30,
    ...over,
  };
}

describe("photo-quality eval grading", () => {
  it("reads the pick judge's JSON, fenced or not, and refuses a malformed one", () => {
    expect(parsePickVerdict('```json\n{"right_model":"Yes","plain_background":true,"retail_scene":false,"reason":"ok"}\n```')).toEqual({
      rightModel: "yes",
      plainBackground: true,
      retailScene: false,
      reason: "ok",
    });
    expect(parsePickVerdict('{"right_model":"maybe","plain_background":true,"retail_scene":false}')).toBeNull();
    expect(parsePickVerdict('{"right_model":"no","plain_background":"yes","retail_scene":false}')).toBeNull();
    expect(parsePickVerdict("no json here")).toBeNull();
  });

  it("reads the cutout judge's JSON", () => {
    const verdict = parseCutoutVerdict('{"edges":"rough","product_intact":true,"background_left":false,"reason":"thin halo"}');
    expect(verdict).toEqual({
      edges: "rough",
      productIntact: true,
      backgroundLeft: false,
      reason: "thin halo",
    });
    expect(isCleanCutout(verdict!)).toBe(false);
    expect(isCleanCutout({ ...verdict!, edges: "clean" })).toBe(true);
    expect(parseCutoutVerdict('{"edges":"fine","product_intact":true,"background_left":false}')).toBeNull();
  });

  it("a good pick needs the right model, a plain backdrop and no shop", () => {
    expect(isGoodPick(good)).toBe(true);
    expect(isGoodPick({ ...good, rightModel: "unsure" })).toBe(false);
    expect(isGoodPick({ ...good, plainBackground: false })).toBe(false);
    expect(isGoodPick({ ...good, retailScene: true })).toBe(false);
  });

  it("matches the maker's hosts and their subdomains only", () => {
    expect(onMakerHost("https://formlabs.com/x.png", ["formlabs.com"])).toBe(true);
    expect(onMakerHost("https://media.formlabs.com/x.png", ["formlabs.com"])).toBe(true);
    expect(onMakerHost("https://notformlabs.com/x.png", ["formlabs.com"])).toBe(false);
    expect(onMakerHost("not a url", ["formlabs.com"])).toBe(false);
  });

  it("scores every case, counting a failed search as a miss", () => {
    const results = [
      result({
        top: [
          {
            url: "https://formlabs.com/a.png",
            host: "formlabs.com",
            verdict: good,
          },
        ],
        cutout: {
          kind: "judged",
          cleaned: "cutout",
          verdict: {
            edges: "clean",
            productIntact: true,
            backgroundLeft: false,
            reason: "",
          },
        },
      }),
      result({
        name: "Cricut Maker 3",
        makerPhoto: false,
        top: [
          {
            url: "https://shop.example/b.jpg",
            host: "shop.example",
            verdict: busy,
          },
          {
            url: "https://cricut.com/c.png",
            host: "cricut.com",
            verdict: good,
          },
        ],
        cutout: { kind: "as_is", note: "busy_background" },
      }),
      result({
        name: "Shaper Origin",
        searchError: "No new picture of it was found.",
        optionCount: 0,
        makerPhoto: false,
      }),
      result({
        name: "Ultimaker S5",
        top: [
          {
            url: "https://ultimaker.com/d.png",
            host: "ultimaker.com",
            verdict: null,
            error: "download: http_403",
          },
        ],
      }),
    ];
    const summary = summarize(results, 0.42);
    expect(summary).toMatchObject({
      cases: 4,
      searched: 3,
      top1Good: 0.25,
      top1RightModel: 0.5,
      makerPhoto: 0.5,
      top3AnyGood: 0.5,
      cutoutClean: 1,
      cutoutsMade: 1,
    });

    const report = formatReport(results, summary);
    expect(report).toContain("Top pick good (right model, plain, not a shop): 25%");
    expect(report).toContain("search: No new picture of it was found.");
    expect(report).toContain("kept as is (busy_background)");
    expect(report).toContain("not judged (download: http_403)");
    expect(report).toContain("$0.420");
  });

  it("has a dozen distinct catalogue tools, each with a maker host", () => {
    expect(PHOTO_EVAL_CASES.length).toBe(12);
    expect(new Set(PHOTO_EVAL_CASES.map((testCase) => testCase.name)).size).toBe(12);
    for (const testCase of PHOTO_EVAL_CASES) expect(testCase.makerHosts.length).toBeGreaterThan(0);
  });
});
