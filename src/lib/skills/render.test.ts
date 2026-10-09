import { composeSkillSections } from "./compose";
import { emptyDraft, type SkillDraft } from "./format";
import type { SkillInputs } from "./inputs";
import { COMPACT_TRIMMED_NOTE, renderSkillCompact, renderSkillMarkdown, skillDescription } from "./render";

/**
 * Composing and rendering a skill (tool skills spec 2026-10-07 §5.2.2 steps
 * 6–7, §5.6): the lab's facts first and by code, the sections in order, the
 * cited sources only, deterministic markdown, and a compact form that fits
 * its budget without ever dropping Safety.
 */

function inputs(patch: Partial<SkillInputs["tool"]> = {}, notes: string[] = ["Put a cutting mat under the work."]): SkillInputs {
  const tool = {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "trotec-speedy-400",
    name: "Trotec Speedy 400",
    officialName: null,
    category: "Laser cutting",
    location: "Laser room",
    itemKind: "equipment",
    trainingRequired: true,
    ppe: ["Safety glasses"],
    materials: ["Acrylic"],
    useRestrictions: "Staff present for first cut",
    emergencyStop: "Red button on the right of the lid",
    description: "A CO2 laser cutter.",
    published: true,
    ...patch,
  };
  const toolNotes = notes.map((text, i) => ({ id: `N${i + 1}`, text }));
  return {
    tool,
    toolNotes,
    labNotes: [{ id: "L1", text: "Clean your station." }],
    research: null,
    links: [{ id: "K1", title: "Trotec SOP", type: "SOP", url: "https://trotec.example/sop" }],
    passages: [{ id: "M1", topic: "operating", documentId: "doc-1", title: "Speedy 400 Manual", pageStart: 12, pageEnd: 13, section: ["Operation"], content: "…" }],
    sources: [
      { id: "T1", kind: "catalog", toolName: tool.name },
      ...toolNotes.map((note) => ({ id: note.id, kind: "lab_note" as const, scope: "tool" as const, text: note.text })),
      { id: "L1", kind: "lab_note", scope: "lab", text: "Clean your station." },
      { id: "K1", kind: "link", title: "Trotec SOP", type: "SOP", url: "https://trotec.example/sop" },
      { id: "M1", kind: "manual", documentId: "doc-1", title: "Speedy 400 Manual", pageStart: 12, pageEnd: 13, section: ["Operation"] },
    ],
  };
}

function guarded(patch: Partial<SkillDraft> = {}) {
  return { draft: { ...emptyDraft(), ...patch }, removed: [], unknownCites: [] };
}

const META = { toolName: "Trotec Speedy 400", slug: "trotec-speedy-400", version: 3, generatedAt: "2026-10-07T18:00:00.000Z", model: "openai/gpt-6-luna" };

describe("composeSkillSections", () => {
  it("puts the lab's facts first, by code: lab notes, training, PPE, restrictions, the emergency stop, the companion line", () => {
    const { sections } = composeSkillSections(
      inputs(),
      guarded({
        beforeYouStart: [{ text: "Check the honeycomb is in", cites: ["M1"] }],
        safety: [{ text: "Never leave it running", cites: ["L1"] }],
        whenToGetStaff: [{ text: "Smoke that will not clear", cites: ["M1"] }],
      })
    );
    expect(sections.beforeYouStart.map((item) => [item.origin, item.text])).toEqual([
      ["lab", "Lab note: Put a cutting mat under the work."],
      ["lab", "Training: the lab requires training before you use this machine. Ask staff for it before your first use."],
      ["lab", "Protective equipment: Safety glasses"],
      ["lab", "Use restrictions: Staff present for first cut"],
      ["model", "Check the honeycomb is in"],
    ]);
    expect(sections.beforeYouStart[0].cites).toEqual(["N1"]);
    expect(sections.safety[0]).toEqual({ text: "Emergency stop: Red button on the right of the lid", cites: ["T1"], origin: "lab" });
    expect(sections.whenToGetStaff.at(-1)).toMatchObject({ origin: "lab", cites: [] });
    expect(sections.whenToGetStaff.at(-1)!.text).toMatch(/SuperMaker/);
  });

  it("never reads a missing PPE list as 'none needed', and says so when the emergency stop is not recorded", () => {
    const { sections } = composeSkillSections(inputs({ ppe: [], emergencyStop: null, useRestrictions: null }, []), guarded());
    expect(sections.beforeYouStart.map((item) => item.text)).toEqual([
      "Training: the lab requires training before you use this machine. Ask staff for it before your first use.",
      "Protective equipment: the lab's record lists none. Ask staff what to wear before you start.",
    ]);
    expect(sections.safety[0].text).toBe("Emergency stop: not in the lab's sources. Ask staff where it is before you start.");
  });

  it("keeps only the sources the skill cites, in the order offered", () => {
    const { sources } = composeSkillSections(inputs(), guarded({ operatingProcedure: [{ text: "Focus the lens", cites: ["M1"] }] }));
    expect(sources.map((source) => source.id)).toEqual(["T1", "N1", "M1"]);
  });
});

describe("renderSkillMarkdown", () => {
  const { sections, sources } = composeSkillSections(
    inputs(),
    guarded({
      operatingProcedure: [
        { text: "Turn on the exhaust", cites: ["M1"] },
        { text: "Load the [file](https://evil.example) from the PC", cites: ["M1"] },
      ],
      troubleshooting: [{ symptom: "Cut does not go through", check: "Focus distance", fix: "Refocus with the gauge", cites: ["M1"] }],
      notInSources: ["Maximum material thickness"],
    })
  );
  const markdown = renderSkillMarkdown(META, sections, sources);

  it("opens with the SKILL.md-style header and the note every reader gets", () => {
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain('name: "trotec-speedy-400"');
    expect(markdown).toContain(`description: ${JSON.stringify(skillDescription("Trotec Speedy 400"))}`);
    expect(skillDescription("Trotec Speedy 400")).toBe("Use when someone asks to operate, debug, or plan a build with the Trotec Speedy 400.");
    expect(markdown).toContain("version: 3");
    expect(markdown).toContain("generated: 2026-10-07");
    expect(markdown).toContain("# Trotec Speedy 400: operating guide");
    expect(markdown).toMatch(/Check the manual and lab staff for anything safety-related/);
  });

  it("renders the sections in order, the procedure numbered, troubleshooting as symptom, check and fix", () => {
    const order = ["## Quick facts", "## Before you start", "## Operating procedure", "## Troubleshooting", "## Safety and emergency stop", "## When to get staff", "## Not in the lab's sources", "## Sources"];
    const at = order.map((heading) => markdown.indexOf(heading));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(markdown).toContain("1. Turn on the exhaust [M1]");
    expect(markdown).toContain("- **Cut does not go through** Check: Focus distance Fix: Refocus with the gauge [M1]");
    // Sections with nothing in them are left out.
    expect(markdown).not.toContain("## Materials");
  });

  it("flattens a link the model wrote, so a skill never carries one", () => {
    expect(markdown).toContain("2. Load the file from the PC [M1]");
    expect(markdown).not.toContain("evil.example");
  });

  it("lists every cited source in full", () => {
    expect(markdown).toContain("- [M1] Speedy 400 Manual, pp. 12–13 (Operation)");
    expect(markdown).toContain("- [N1] Lab note: Put a cutting mat under the work.");
    expect(markdown).toContain("- [T1] The lab's catalogue record for the Trotec Speedy 400");
  });

  it("is deterministic", () => {
    expect(renderSkillMarkdown(META, sections, sources)).toBe(markdown);
  });
});

describe("renderSkillCompact", () => {
  const long = (n: number, cites = ["M1"]) => Array.from({ length: n }, (_, i) => ({ text: `Item ${i} ${"words ".repeat(30)}`, cites }));
  const { sections, sources } = composeSkillSections(
    inputs(),
    guarded({
      quickFacts: long(8),
      operatingProcedure: long(12),
      settingsAndLimits: long(12),
      materials: long(12),
      troubleshooting: Array.from({ length: 10 }, (_, i) => ({ symptom: `Symptom ${i} ${"x ".repeat(40)}`, check: "Check", fix: "Fix", cites: ["M1"] })),
      safety: [{ text: "Keep the lid closed while it cuts", cites: ["M1"] }],
    })
  );

  it("fits in full when there is room, with one-line sources", () => {
    const text = renderSkillCompact(META, sections, sources, 100_000);
    expect(text).not.toContain("---");
    expect(text).toContain("Sources: T1 lab record · N1 lab note · M1 Speedy 400 Manual p. 12–13");
    expect(text).not.toContain(COMPACT_TRIMMED_NOTE);
  });

  it("drops lower sections to fit, never Safety, Before you start, the procedure or When to get staff, and says it was shortened", () => {
    const text = renderSkillCompact(META, sections, sources, 7_000);
    expect(text.length).toBeLessThanOrEqual(7_000);
    expect(text).not.toContain("## Materials");
    expect(text).toContain("## Safety and emergency stop");
    expect(text).toContain("Keep the lid closed while it cuts");
    expect(text).toContain("## Before you start");
    expect(text).toContain("## When to get staff");
    expect(text).toContain(COMPACT_TRIMMED_NOTE);
  });

  it("cuts at a line as a last resort, still within the budget", () => {
    const text = renderSkillCompact(META, sections, sources, 1_500);
    expect(text.length).toBeLessThanOrEqual(1_500);
    expect(text.endsWith(COMPACT_TRIMMED_NOTE)).toBe(true);
  });
});
