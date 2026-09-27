import { parseNotionId } from "./notion-id";

const HEX = "0f5e4a3c11112222333344445555aaaa";
const ID = "0f5e4a3c-1111-2222-3333-44445555aaaa";

describe("parseNotionId", () => {
  it("accepts a bare 32-hex id, in either case", () => {
    expect(parseNotionId(HEX)).toBe(ID);
    expect(parseNotionId(HEX.toUpperCase())).toBe(ID);
    expect(parseNotionId(`  ${HEX}\n`)).toBe(ID);
  });

  it("accepts a dashed uuid and lower-cases it", () => {
    expect(parseNotionId(ID)).toBe(ID);
    expect(parseNotionId(ID.toUpperCase())).toBe(ID);
  });

  it("reads the id off the end of a slugged notion.so URL", () => {
    expect(parseNotionId(`https://www.notion.so/MakerLab-Tools-mirror-${HEX}`)).toBe(ID);
    expect(parseNotionId(`https://www.notion.so/cornell-tech/MakerLab-Tools-mirror-${HEX}`)).toBe(ID);
    expect(parseNotionId(`https://notion.so/${HEX}`)).toBe(ID);
    // No scheme, as copied out of some address bars.
    expect(parseNotionId(`www.notion.so/Page-${HEX}`)).toBe(ID);
  });

  it("ignores ?v=, ?pvs= and the hash", () => {
    const view = "9999888877776666555544443333aaaa";
    expect(parseNotionId(`https://www.notion.so/${HEX}?v=${view}`)).toBe(ID);
    expect(parseNotionId(`https://www.notion.so/Tools-${HEX}?pvs=4`)).toBe(ID);
    expect(parseNotionId(`https://www.notion.so/Tools-${HEX}?v=${view}&pvs=4#${view}`)).toBe(ID);
  });

  it("accepts notion.site public pages", () => {
    expect(parseNotionId(`https://cornell-makerlab.notion.site/Mirror-${HEX}`)).toBe(ID);
    expect(parseNotionId(`https://notion.site/${ID}`)).toBe(ID);
  });

  it("takes the last id in the path", () => {
    const other = "11112222333344445555666677778888";
    expect(parseNotionId(`https://www.notion.so/${other}/Child-${HEX}`)).toBe(ID);
  });

  it("returns null for anything else", () => {
    expect(parseNotionId("")).toBeNull();
    expect(parseNotionId("   ")).toBeNull();
    expect(parseNotionId("not an id")).toBeNull();
    expect(parseNotionId(HEX.slice(1))).toBeNull();
    expect(parseNotionId(`${HEX}0`)).toBeNull();
    expect(parseNotionId(`https://example.com/Page-${HEX}`)).toBeNull();
    expect(parseNotionId(`https://evilnotion.so/Page-${HEX}`)).toBeNull();
    expect(parseNotionId("https://www.notion.so/Just-a-slug")).toBeNull();
    // A 33-hex run is not an id with a stray character; it is not an id.
    expect(parseNotionId(`https://www.notion.so/a${HEX}`)).toBeNull();
    expect(parseNotionId(`javascript:${HEX}`)).toBeNull();
  });
});
