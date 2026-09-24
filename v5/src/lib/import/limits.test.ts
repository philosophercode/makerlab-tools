import {
  approxPages,
  documentTooLong,
  IMPORT_DOCUMENT_MAX_CHARS,
  IMPORT_DOCUMENT_MAX_PAGES,
  parseTooManyItemsReason,
  tooManyItemsReason,
} from "./limits";

/**
 * The document cap in pages (bulk intake spec, amendment 2026-09-24): the
 * limit stays 200,000 characters, said as about 60 pages.
 */

describe("the document cap", () => {
  it("is 200,000 characters, about 60 pages", () => {
    expect(IMPORT_DOCUMENT_MAX_CHARS).toBe(200_000);
    expect(IMPORT_DOCUMENT_MAX_PAGES).toBe(60);
  });

  it("says a length in pages, at least one", () => {
    expect(approxPages(280_000)).toBe(85);
    expect(approxPages(10)).toBe(1);
  });

  it("refuses only past the limit, and never says the same number of pages as the limit", () => {
    expect(documentTooLong(IMPORT_DOCUMENT_MAX_CHARS)).toBeNull();
    expect(documentTooLong(IMPORT_DOCUMENT_MAX_CHARS + 1)).toEqual({ pages: 61, limitPages: 60, limitChars: 200_000 });
    expect(documentTooLong(280_000)).toEqual({ pages: 85, limitPages: 60, limitChars: 200_000 });
  });
});

describe("a document naming too many items", () => {
  it("round-trips its count through the stored reason", () => {
    expect(parseTooManyItemsReason(tooManyItemsReason(1200))).toBe(1200);
    expect(parseTooManyItemsReason("no_items")).toBeNull();
  });
});
