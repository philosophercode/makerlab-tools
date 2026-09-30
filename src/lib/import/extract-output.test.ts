import { chunkDocument, ExtractOutputError, MAX_ITEMS_PER_CHUNK, parseExtractOutput } from "./extract-output";
import { IMPORT_DOCUMENT_MAX_CHARS } from "./limits";

describe("parseExtractOutput (bulk intake spec §10: malformed JSON rejected, fields capped)", () => {
  it("reads the items, tolerating a fenced block", () => {
    const answer = '```json\n{"items":[{"name":"Formlabs Form 2","brand":"Formlabs","quantity":2,"serials":["F1","F2"],"labDocs":["https://docs.google.com/d/1"]}]}\n```';
    expect(parseExtractOutput(answer)).toEqual([
      {
        name: "Formlabs Form 2",
        brand: "Formlabs",
        model: null,
        quantity: 2,
        serials: ["F1", "F2"],
        category: null,
        location: null,
        notes: null,
        links: [],
        labDocs: ["https://docs.google.com/d/1"],
      },
    ]);
  });

  it("refuses an answer that is not the JSON asked for", () => {
    expect(() => parseExtractOutput("Here are the items: Form 2, Drill")).toThrow(ExtractOutputError);
    expect(() => parseExtractOutput('{"tools": []}')).toThrow(/no "items" list/);
  });

  it("drops an item with no name and caps long strings and runaway lists", () => {
    const long = "x".repeat(5000);
    const items = parseExtractOutput(
      JSON.stringify({
        items: [{ brand: "Nameless" }, { name: long, notes: long }, ...Array.from({ length: 300 }, (_, i) => ({ name: `Item ${i}` }))],
      })
    );
    expect(items[0].name).toHaveLength(200);
    expect(items[0].notes).toHaveLength(1000);
    expect(items.length).toBeLessThanOrEqual(MAX_ITEMS_PER_CHUNK);
  });
});

describe("chunkDocument", () => {
  it("cuts at a line break near the window's end", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Line ${i}: a bench grinder or similar`).join("\n");
    const { chunks, truncated } = chunkDocument(text, 1000);
    expect(truncated).toBe(false);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
      expect(chunk.endsWith("\n")).toBe(true);
    }
  });

  it("caps a huge document and says so", () => {
    const { chunks, truncated } = chunkDocument("a".repeat(IMPORT_DOCUMENT_MAX_CHARS + 10));
    expect(truncated).toBe(true);
    expect(chunks.join("")).toHaveLength(IMPORT_DOCUMENT_MAX_CHARS);
  });
});
