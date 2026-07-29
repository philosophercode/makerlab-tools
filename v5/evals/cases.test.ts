import { loadCases, parseCaseFile, parseYaml } from "./cases";

// Case loading must fail loudly at load — before any model call — on malformed
// YAML, unknown assertion kinds, or assertions missing their argument (design
// spec §10). A harness that reports green because an assertion silently no-ops
// is the failure mode this suite exists to prevent.

const wellFormed = `
- id: laser-by-capability
  prompt: "I need to cut 6mm plywood. What should I use?"
  context: { page: gallery }
  assert:
    - kind: mentions_tool
      value: "Trotec Speedy 400"
    - kind: no_unknown_tools
`;

describe("parseYaml (supported subset)", () => {
  it("parses block mappings, block sequences and flow collections", () => {
    expect(parseYaml(wellFormed, "t.yaml")).toEqual([
      {
        id: "laser-by-capability",
        prompt: "I need to cut 6mm plywood. What should I use?",
        context: { page: "gallery" },
        assert: [
          { kind: "mentions_tool", value: "Trotec Speedy 400" },
          { kind: "no_unknown_tools" },
        ],
      },
    ]);
  });

  it("parses flow sequences and ignores comments", () => {
    const source = `
# a comment
- id: a
  value: ["256", "mm"] # trailing comment
  fields: [build_volume]
`;
    expect(parseYaml(source, "t.yaml")).toEqual([
      { id: "a", value: ["256", "mm"], fields: ["build_volume"] },
    ]);
  });

  it("rejects tabs, duplicate keys and unterminated quotes", () => {
    expect(() => parseYaml("\tid: a", "t.yaml")).toThrow(/tabs/);
    expect(() => parseYaml("- id: a\n  id: b", "t.yaml")).toThrow(/duplicate key/);
    expect(() => parseYaml('- prompt: "oops', "t.yaml")).toThrow(/t.yaml:1/);
  });

  it("rejects constructs outside the supported subset instead of guessing", () => {
    expect(() => parseYaml("- prompt: |\n    multi\n", "t.yaml")).toThrow(/block scalars/);
    expect(() => parseYaml("- value: [a, b", "t.yaml")).toThrow(/unterminated flow sequence/);
  });
});

describe("parseCaseFile validation", () => {
  it("accepts a well-formed file", () => {
    const [testCase] = parseCaseFile(wellFormed, "t.yaml");
    expect(testCase.id).toBe("laser-by-capability");
    expect(testCase.context.page).toBe("gallery");
    expect(testCase.assert).toHaveLength(2);
    expect(testCase.file).toBe("t.yaml");
  });

  it("rejects an unknown assertion kind, listing the valid ones", () => {
    const source = `
- id: a
  prompt: "hi"
  assert:
    - kind: vibes_check
`;
    expect(() => parseCaseFile(source, "t.yaml")).toThrow(/unknown assertion kind/);
    expect(() => parseCaseFile(source, "t.yaml")).toThrow(/no_fabricated_specs/);
  });

  it("rejects an assertion missing its required argument", () => {
    expect(() =>
      parseCaseFile(`- id: a\n  prompt: "hi"\n  assert:\n    - kind: mentions_tool\n`, "t.yaml")
    ).toThrow(/requires a "value"/);
    expect(() =>
      parseCaseFile(
        `- id: a\n  prompt: "hi"\n  assert:\n    - kind: no_fabricated_specs\n`,
        "t.yaml"
      )
    ).toThrow(/requires a non-empty "fields" list/);
  });

  it("rejects an unknown spec field", () => {
    const source = `
- id: a
  prompt: "hi"
  assert:
    - kind: no_fabricated_specs
      fields: [bed_temperature]
`;
    expect(() => parseCaseFile(source, "t.yaml")).toThrow(/unknown spec field/);
  });

  it("rejects a bad context", () => {
    expect(() =>
      parseCaseFile(`- id: a\n  prompt: "hi"\n  context: { page: tool }\n  assert:\n    - kind: no_unknown_tools\n`, "t.yaml")
    ).toThrow(/requires a toolId/);
    expect(() =>
      parseCaseFile(`- id: a\n  prompt: "hi"\n  context: { surface: chat }\n  assert:\n    - kind: no_unknown_tools\n`, "t.yaml")
    ).toThrow(/unknown context key/);
  });

  it("requires an id, a prompt and at least one assertion", () => {
    expect(() => parseCaseFile(`- prompt: "hi"\n  assert:\n    - kind: no_unknown_tools\n`, "t.yaml")).toThrow(
      /case id must be a non-empty string/
    );
    expect(() => parseCaseFile(`- id: a\n  prompt: "hi"\n`, "t.yaml")).toThrow(/non-empty list/);
  });
});

describe("the shipped case set", () => {
  it("loads, validates and has unique ids", () => {
    const cases = loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("covers catalog lookup, manual grounding, tool calling and honest absence", () => {
    const files = new Set(loadCases().map((c) => c.file));
    expect(files).toEqual(
      new Set([
        "catalog-lookup.yaml",
        "honest-absence.yaml",
        "manual-grounding.yaml",
        "tool-calling.yaml",
      ])
    );
  });

  it("only focuses machines that exist in the fixture catalog", async () => {
    const { evalFixture } = await import("./fixtures");
    for (const evalCase of loadCases()) {
      if (!evalCase.context.toolId) continue;
      expect(evalFixture.slugs).toContain(evalCase.context.toolId);
    }
  });
});
