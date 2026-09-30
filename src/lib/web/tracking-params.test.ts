import { cleanLink, stripTrackingParams } from "./tracking-params";

describe("stripTrackingParams (amendment 2026-09-28)", () => {
  it("drops utm_* and click ids, keeping the rest in order and the fragment", () => {
    expect(
      stripTrackingParams(
        "https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20X1-Carbon.pdf?utm_source=chatgpt.com"
      )
    ).toBe("https://cdn1.bambulab.com/documentation/Quick%20Start%20Guide%20for%20X1-Carbon.pdf");
    expect(stripTrackingParams("https://m.test/p?id=3&utm_medium=x&gclid=1&lang=en#page=4")).toBe("https://m.test/p?id=3&lang=en#page=4");
    expect(stripTrackingParams("https://m.test/p?FBCLID=1")).toBe("https://m.test/p");
  });

  it("drops YouTube's share token but not an `si` elsewhere", () => {
    expect(stripTrackingParams("https://youtu.be/E6X-2QdeIV8?si=ZMiWOTIOrXNpjUUh")).toBe("https://youtu.be/E6X-2QdeIV8");
    expect(stripTrackingParams("https://www.youtube.com/watch?v=abc&si=xyz")).toBe("https://www.youtube.com/watch?v=abc");
    expect(stripTrackingParams("https://maker.test/doc?si=12")).toBe("https://maker.test/doc?si=12");
  });

  it("leaves a signed or ordinary query alone, and anything that is not a web URL", () => {
    const signed = "https://data2.manualslib.com/pdf7/178/17733/1773295-makita/rt0700c.pdf?f87ea5111574b42857c3a324a2e8ccfb";
    expect(stripTrackingParams(signed)).toBe(signed);
    expect(stripTrackingParams("https://docs.google.com/document/d/1/edit?usp=sharing")).toBe(
      "https://docs.google.com/document/d/1/edit?usp=sharing"
    );
    expect(stripTrackingParams("not a url?utm_source=x")).toBe("not a url?utm_source=x");
    expect(cleanLink(null)).toBeNull();
  });
});
