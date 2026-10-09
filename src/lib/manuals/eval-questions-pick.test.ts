// @vitest-environment node
import {
  DEFAULT_EVAL_QUESTIONS,
  documentTextHash,
  evalQuestionCount,
  isAskable,
  isBoilerplate,
  passagePages,
  pickPassages,
  questionsFor,
  SPARE_PASSAGES,
  type PassageForQuestions,
} from "./eval-questions-pick";

/**
 * Which passages eval questions are written from, and the text digest that
 * makes them once per text (manual text spec amendment 2026-10-07).
 */

const BODY =
  "Lift the resin tank straight up out of the carrier, keeping it level so resin does not spill. " +
  "Set it on a flat surface. Slide the new tank in until both tabs are seated, then close the cover and run a test print. ";

function passage(ordinal: number, overrides: Partial<PassageForQuestions> = {}): PassageForQuestions {
  return { ordinal, sectionPath: [`Chapter ${ordinal}`], pageStart: ordinal + 1, pageEnd: ordinal + 1, content: BODY.repeat(2), ...overrides };
}

describe("evalQuestionCount", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to four, takes 0 to switch it off, and ignores a bad value", () => {
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "");
    expect(evalQuestionCount()).toBe(DEFAULT_EVAL_QUESTIONS);
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "0");
    expect(evalQuestionCount()).toBe(0);
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "6");
    expect(evalQuestionCount()).toBe(6);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "lots");
    expect(evalQuestionCount()).toBe(DEFAULT_EVAL_QUESTIONS);
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "99");
    expect(evalQuestionCount()).toBe(DEFAULT_EVAL_QUESTIONS);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("documentTextHash", () => {
  it("is the same for the same text in any order and changes when a word does", () => {
    const pages = [
      { pageNumber: 1, text: "Intro" },
      { pageNumber: 2, text: "Replace the tank" },
    ];
    expect(documentTextHash(pages)).toBe(documentTextHash([...pages].reverse()));
    expect(documentTextHash(pages)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(documentTextHash([pages[0], { pageNumber: 2, text: "Replace the tray" }])).not.toBe(documentTextHash(pages));
    // A page moved is a different text, even with the same words.
    expect(documentTextHash([{ pageNumber: 1, text: "Intro" }, { pageNumber: 3, text: "Replace the tank" }])).not.toBe(documentTextHash(pages));
  });
});

describe("isBoilerplate / isAskable", () => {
  it("skips contents, index, legal and warranty pages, but not a box's contents", () => {
    expect(isBoilerplate(passage(1, { sectionPath: ["Contents"] }))).toBe(true);
    expect(isBoilerplate(passage(1, { sectionPath: ["Appendix", "Index"] }))).toBe(true);
    expect(isBoilerplate(passage(1, { sectionPath: ["Warranty"] }))).toBe(true);
    expect(isBoilerplate(passage(1, { sectionPath: ["FCC compliance statement"] }))).toBe(true);
    expect(isBoilerplate(passage(1, { sectionPath: [], content: `Copyright notice\n${BODY}` }))).toBe(true);
    expect(isBoilerplate(passage(1, { sectionPath: ["Box contents"] }))).toBe(false);
    expect(isBoilerplate(passage(1, { sectionPath: ["Maintenance", "Replacing the resin tank"] }))).toBe(false);
  });

  it("skips a page of dot leaders and page numbers", () => {
    const toc = ["Safety .......... 3", "Setup .......... 7", "Printing .......... 12", "Maintenance .......... 30", "Troubleshooting 41"].join("\n");
    expect(isBoilerplate(passage(1, { sectionPath: [], content: toc }))).toBe(true);
  });

  it("needs enough words and at most two pages", () => {
    expect(isAskable(passage(1))).toBe(true);
    expect(isAskable(passage(1, { content: "Replace the tank." }))).toBe(false);
    expect(isAskable(passage(1, { pageStart: 4, pageEnd: 5 }))).toBe(true);
    expect(isAskable(passage(1, { pageStart: 4, pageEnd: 6 }))).toBe(false);
  });
});

describe("questionsFor", () => {
  it("asks fewer of a short manual: one per two askable passages, at least one, at most the count", () => {
    expect(questionsFor(0, 4)).toBe(0);
    expect(questionsFor(1, 4)).toBe(1);
    expect(questionsFor(3, 4)).toBe(2);
    expect(questionsFor(40, 4)).toBe(4);
    expect(questionsFor(40, 0)).toBe(0);
  });
});

describe("pickPassages", () => {
  it("spreads the picks through the manual, one per section where it can, with spares", () => {
    const passages = Array.from({ length: 30 }, (_, i) => passage(i, { sectionPath: [`Chapter ${Math.floor(i / 5)}`] }));
    const picked = pickPassages(passages, 4);
    expect(picked).toHaveLength(4 + SPARE_PASSAGES);
    // Document order, from six different chapters, not the first chapter's six passages.
    expect(picked.map((p) => p.ordinal)).toEqual([...picked.map((p) => p.ordinal)].sort((a, b) => a - b));
    expect(new Set(picked.map((p) => p.sectionPath[0])).size).toBe(6);
  });

  it("never offers a passage that is not askable, and offers all of a short manual", () => {
    const passages = [passage(0, { sectionPath: ["Contents"] }), passage(1), passage(2, { content: "Too short." }), passage(3)];
    expect(pickPassages(passages, 4).map((p) => p.ordinal)).toEqual([1, 3]);
    expect(pickPassages([], 4)).toEqual([]);
  });

  it("lists a passage's pages", () => {
    expect(passagePages({ pageStart: 41, pageEnd: 42 })).toEqual([41, 42]);
  });
});
