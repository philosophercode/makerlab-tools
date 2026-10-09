import type { SkillBullet, SkillDraft, SkillSections, SkillSource, RemovedItem } from "./format.ts";
import type { SkillInputs } from "./inputs.ts";

/**
 * The checked draft and the lab's own facts, made one skill (tool skills spec
 * 2026-10-07 §5.2.2 step 6). Pure.
 *
 * **The lab's facts go in by code, first** (`origin: "lab"`), so the model can
 * neither leave them out nor reword them: Quick facts opens with category,
 * location and training; Before you start opens with every lab note for the
 * tool, then training, protective equipment and restrictions; Safety opens
 * with the emergency stop — or says the lab's sources do not name it; When to
 * get staff ends with the companion line. Each cites the catalogue record
 * (`T1`) or the note (`N…`) it came from.
 *
 * The stored sources are only the ones the skill cites, in the order offered.
 */

const COMPANION_LINE =
  "Ask a SuperMaker or other lab staff before your first use, whenever anything looks unsafe or broken, and for anything this guide does not cover.";

export function composeSkillSections(
  inputs: SkillInputs,
  guarded: { draft: SkillDraft; removed: RemovedItem[]; unknownCites: string[] }
): { sections: SkillSections; sources: SkillSource[] } {
  const { tool } = inputs;
  const lab = (text: string, cites: string[] = ["T1"]): SkillBullet => ({ text, cites, origin: "lab" });
  const model = (items: SkillDraft["quickFacts"]): SkillBullet[] => items.map((item) => ({ text: item.text, cites: item.cites, origin: "model" }));

  const quickFacts: SkillBullet[] = [
    ...(tool.category ? [lab(`Category: ${tool.category}`)] : []),
    ...(tool.location ? [lab(`Location in the lab: ${tool.location}`)] : []),
    lab(tool.trainingRequired ? "Training: required by the lab before use" : "Training: not required by the lab"),
    ...model(guarded.draft.quickFacts),
  ];

  const beforeYouStart: SkillBullet[] = [
    ...inputs.toolNotes.map((note) => lab(`Lab note: ${note.text}`, [note.id])),
    lab(
      tool.trainingRequired
        ? "Training: the lab requires training before you use this machine. Ask staff for it before your first use."
        : "Training: the lab does not require training for this machine. Ask a SuperMaker to show you the first time."
    ),
    lab(
      tool.ppe.length > 0
        ? `Protective equipment: ${tool.ppe.join(", ")}`
        : "Protective equipment: the lab's record lists none. Ask staff what to wear before you start."
    ),
    ...(tool.useRestrictions ? [lab(`Use restrictions: ${tool.useRestrictions}`)] : []),
    ...model(guarded.draft.beforeYouStart),
  ];

  const safety: SkillBullet[] = [
    tool.emergencyStop
      ? lab(`Emergency stop: ${tool.emergencyStop}`)
      : lab("Emergency stop: not in the lab's sources. Ask staff where it is before you start.", []),
    ...model(guarded.draft.safety),
  ];

  const whenToGetStaff: SkillBullet[] = [...model(guarded.draft.whenToGetStaff), lab(COMPANION_LINE, [])];

  const sections: SkillSections = {
    format: 1,
    quickFacts,
    beforeYouStart,
    operatingProcedure: model(guarded.draft.operatingProcedure),
    settingsAndLimits: model(guarded.draft.settingsAndLimits),
    materials: model(guarded.draft.materials),
    troubleshooting: guarded.draft.troubleshooting.map((row) => ({ ...row })),
    safety,
    whenToGetStaff,
    notInSources: [...guarded.draft.notInSources],
    removed: guarded.removed,
    unknownCites: guarded.unknownCites,
  };
  return { sections, sources: citedSources(sections, inputs.sources) };
}

/** Every id the skill cites. */
export function citedIds(sections: SkillSections): Set<string> {
  const ids = new Set<string>();
  const bullets = [
    sections.quickFacts,
    sections.beforeYouStart,
    sections.operatingProcedure,
    sections.settingsAndLimits,
    sections.materials,
    sections.safety,
    sections.whenToGetStaff,
  ].flat();
  for (const item of [...bullets, ...sections.troubleshooting]) for (const id of item.cites) ids.add(id);
  return ids;
}

function citedSources(sections: SkillSections, offered: readonly SkillSource[]): SkillSource[] {
  const ids = citedIds(sections);
  return offered.filter((source) => ids.has(source.id));
}
