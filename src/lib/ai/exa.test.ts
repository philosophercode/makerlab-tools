// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXA_SEARCH_TOOL,
  chatExaSearch,
  countExaCalls,
  exaImageHints,
  exaPageTexts,
  RESEARCH_EXA_TEXT_MAX_CHARS,
  researchExaSearch,
  type StepLike,
} from "./exa";

/**
 * Exa through the Gateway (gateway spec §3.2): the two configurations, the call
 * count the caps read, and the image hints the image stage tops up from.
 */

function exaStep(results: unknown[], toolName = EXA_SEARCH_TOOL): StepLike {
  return {
    toolCalls: [{ toolName }],
    toolResults: [{ toolName, output: { requestId: "r1", results } }],
  };
}

describe("the Exa tool configurations", () => {
  it("gives chat five results with highlights", () => {
    expect(chatExaSearch()).toMatchObject({
      type: "provider",
      id: "gateway.exa_search",
      args: { numResults: 5, contents: { highlights: true } },
    });
  });

  it("gives research six results with page text (12k characters at most), highlights and three image links each", () => {
    expect(researchExaSearch()).toMatchObject({
      type: "provider",
      id: "gateway.exa_search",
      args: { numResults: 6, contents: { text: { maxCharacters: 12000 }, highlights: true, extras: { imageLinks: 3 } } },
    });
  });
});

describe("countExaCalls", () => {
  it("counts exa_search calls and nothing else", () => {
    const steps: StepLike[] = [exaStep([]), { toolCalls: [{ toolName: "read_page" }] }, exaStep([])];
    expect(countExaCalls(steps)).toBe(2);
  });
});

describe("exaImageHints", () => {
  it("takes each result's image, then its image links, attributed to the result's page", () => {
    const steps = [
      exaStep([
        {
          url: "https://maker.test/p1s",
          image: "https://maker.test/og.jpg",
          extras: { imageLinks: ["https://maker.test/a.png", "https://maker.test/b.png"] },
        },
        { url: "https://shop.test/p1s", image: "https://shop.test/p1s.webp" },
      ]),
    ];
    expect(exaImageHints(steps)).toEqual([
      { url: "https://maker.test/og.jpg", source: "exa", pageUrl: "https://maker.test/p1s" },
      { url: "https://maker.test/a.png", source: "exa", pageUrl: "https://maker.test/p1s" },
      { url: "https://maker.test/b.png", source: "exa", pageUrl: "https://maker.test/p1s" },
      { url: "https://shop.test/p1s.webp", source: "exa", pageUrl: "https://shop.test/p1s" },
    ]);
  });

  it("keeps the first sighting of a duplicate, across results and steps", () => {
    const steps = [
      exaStep([{ url: "https://a.test/1", image: "https://cdn.test/x.jpg" }]),
      exaStep([{ url: "https://b.test/2", image: "https://cdn.test/x.jpg", extras: { imageLinks: ["https://cdn.test/y.jpg"] } }]),
    ];
    expect(exaImageHints(steps).map((h) => [h.url, h.pageUrl])).toEqual([
      ["https://cdn.test/x.jpg", "https://a.test/1"],
      ["https://cdn.test/y.jpg", "https://b.test/2"],
    ]);
  });

  it("drops anything that is not an http(s) URL", () => {
    const steps = [
      exaStep([
        {
          url: "https://a.test/1",
          image: "data:image/png;base64,AAAA",
          extras: { imageLinks: ["javascript:alert(1)", "/relative.png", 42, null, "ftp://a.test/x.png", "http://a.test/ok.png"] },
        },
      ]),
    ];
    expect(exaImageHints(steps).map((h) => h.url)).toEqual(["http://a.test/ok.png"]);
  });

  it("unescapes the &amp; Exa sometimes leaves in an image link", () => {
    const steps = [
      exaStep([{ url: "https://a.test/1", extras: { imageLinks: ["https://a.test/_next/image/?url=x.png&amp;w=3840&amp;q=75"] } }]),
    ];
    expect(exaImageHints(steps)[0].url).toBe("https://a.test/_next/image/?url=x.png&w=3840&q=75");
  });

  it("ignores other tools' results, an Exa error, and a result with no page URL's attribution", () => {
    const steps: StepLike[] = [
      exaStep([{ url: "https://a.test/1", image: "https://a.test/i.png" }], "read_page"),
      { toolResults: [{ toolName: EXA_SEARCH_TOOL, output: { error: "rate_limit", message: "slow down" } }] },
      exaStep([{ url: "not a url", image: "https://c.test/i.png" }]),
    ];
    expect(exaImageHints(steps)).toEqual([{ url: "https://c.test/i.png", source: "exa", pageUrl: null }]);
  });

  it("reads content parts when a step has no toolResults list", () => {
    const steps: StepLike[] = [
      {
        content: [
          { type: "tool-call", toolName: EXA_SEARCH_TOOL },
          { type: "tool-result", toolName: EXA_SEARCH_TOOL, output: { results: [{ url: "https://a.test/", image: "https://a.test/i.jpg" }] } },
        ],
      },
    ];
    expect(exaImageHints(steps).map((h) => h.url)).toEqual(["https://a.test/i.jpg"]);
  });

  it("reads the images out of the recorded Phase 0 response", () => {
    const fixture = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../test/gateway/fixtures/check2-exa-01.json", import.meta.url)), "utf8")
    );
    const toolResult = fixture.response.body.content.find((part: { type: string }) => part.type === "tool-result");
    const hints = exaImageHints([
      { toolResults: [{ toolName: EXA_SEARCH_TOOL, output: toolResult.result }] },
    ]);

    expect(hints[0]).toMatchObject({ source: "exa", pageUrl: "https://formlabs.com/3d-printers/form-4/" });
    expect(hints.every((h) => !h.url.includes("&amp;"))).toBe(true);
    // Result 2 and 3 share `default_seo_image.jpg` and two image links; each appears once.
    expect(new Set(hints.map((h) => h.url)).size).toBe(hints.length);
    expect(hints.filter((h) => h.url === "https://formlabs.com/default_seo_image.jpg")).toHaveLength(1);
  });
});

describe("exaPageTexts", () => {
  it("takes each result's page text with its URL and title, in result order, one per URL", () => {
    const steps = [
      exaStep([
        { url: "https://bambulab.com/en/x2d", title: " Bambu Lab X2D ", text: "  The X2D is a dual-nozzle printer.  " },
        { url: "https://shop.test/x2d", title: "", text: "Buy the X2D." },
        { url: "https://no-text.test/", title: "Highlights only", highlights: ["…"] },
      ]),
      exaStep([
        { url: "https://bambulab.com/en/x2d", title: "Again", text: "A later copy." },
        { url: "javascript:alert(1)", title: "Bad", text: "Nope." },
      ]),
      exaStep([{ url: "https://other.test/", text: "Not Exa." }], "read_page"),
    ];
    expect(exaPageTexts(steps)).toEqual([
      { url: "https://bambulab.com/en/x2d", title: "Bambu Lab X2D", text: "The X2D is a dual-nozzle printer." },
      { url: "https://shop.test/x2d", title: null, text: "Buy the X2D." },
    ]);
  });

  it(`caps each text at ${RESEARCH_EXA_TEXT_MAX_CHARS} characters, and gives nothing for an Exa error`, () => {
    const long = "x".repeat(RESEARCH_EXA_TEXT_MAX_CHARS + 50);
    expect(exaPageTexts([exaStep([{ url: "https://a.test/", text: long }])])[0].text).toHaveLength(RESEARCH_EXA_TEXT_MAX_CHARS);
    const error: StepLike = {
      toolResults: [{ toolName: EXA_SEARCH_TOOL, output: { error: "rate_limit", message: "slow down" } }],
    };
    expect(exaPageTexts([error])).toEqual([]);
  });
});
