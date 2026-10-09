// @vitest-environment node

/**
 * `archiveManuals` as a plain function: without the workflow compiler the
 * directives are strings, so the steps are mocked and the orchestration is
 * under test — one step per resource, in order, each ending on its own.
 */

const steps = vi.hoisted(() => ({
  archiveManualStep: vi.fn(),
  indexManualStep: vi.fn(),
  evalQuestionsStep: vi.fn(),
  finishManualArchive: vi.fn(),
}));
vi.mock("../lib/manuals/steps", () => steps);

// The tool skills tail (tool skills spec 2026-10-07 §5.4).
const skills = vi.hoisted(() => ({
  toolSkillTargetsStep: vi.fn(),
  writeToolSkillStep: vi.fn(),
  recordToolSkillFailureStep: vi.fn(),
}));
vi.mock("../lib/skills/steps", () => skills);

import { archiveManuals } from "./archive-manuals";

beforeEach(() => {
  steps.archiveManualStep.mockReset();
  steps.indexManualStep.mockReset().mockResolvedValue([]);
  steps.evalQuestionsStep.mockReset().mockResolvedValue([]);
  steps.finishManualArchive.mockReset().mockResolvedValue(undefined);
  // The setting off: the targets step answers no tools.
  skills.toolSkillTargetsStep.mockReset().mockResolvedValue([]);
  skills.writeToolSkillStep.mockReset();
  skills.recordToolSkillFailureStep.mockReset().mockResolvedValue(true);
});

describe("archiveManuals", () => {
  it("archives each resource in order and counts every outcome, a thrown step as failed", async () => {
    steps.archiveManualStep
      .mockResolvedValueOnce({ status: "archived", reason: "archived" })
      .mockRejectedValueOnce(new Error("retries exhausted"))
      .mockResolvedValueOnce({ status: "skipped", reason: "already_archived" })
      .mockResolvedValueOnce({ status: "failed", reason: "not_pdf", transient: false });

    const counts = { archived: 1, skipped: 1, failed: 2, indexed: 0, indexFailed: 0, passagesBuilt: 0, passagesFailed: 0, questionsWritten: 0, questionsFailed: 0, skillsWritten: 0, skillsFailed: 0 };
    expect(await archiveManuals(["a", "b", "c", "d"])).toEqual(counts);
    expect(steps.archiveManualStep.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d"]);
    expect(steps.finishManualArchive).toHaveBeenCalledWith(counts);
  });

  it("processes a resource's PDFs into text after archiving it, or when it already held one — never after a failure", async () => {
    steps.archiveManualStep
      .mockResolvedValueOnce({ status: "archived", reason: "archived" })
      .mockResolvedValueOnce({ status: "skipped", reason: "has_file" })
      .mockResolvedValueOnce({ status: "skipped", reason: "no_url" })
      .mockResolvedValueOnce({ status: "skipped", reason: "not_found" })
      .mockResolvedValueOnce({ status: "failed", reason: "http_error", transient: false })
      .mockRejectedValueOnce(new Error("retries exhausted"));
    steps.indexManualStep
      .mockResolvedValueOnce([{ status: "indexed", documentStatus: "ready" }])
      .mockResolvedValueOnce([{ status: "indexed", documentStatus: "no_text" }, { status: "skipped" }])
      .mockResolvedValueOnce([]);

    const result = await archiveManuals(["a", "b", "c", "d", "e", "f"]);
    expect(steps.indexManualStep.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ archived: 1, skipped: 3, failed: 2, indexed: 2, indexFailed: 0, passagesBuilt: 0, passagesFailed: 0, questionsWritten: 0, questionsFailed: 0, skillsWritten: 0, skillsFailed: 0 });
  });

  it("never lets processing change what the archive counted", async () => {
    steps.archiveManualStep.mockResolvedValue({ status: "archived", reason: "archived" });
    steps.indexManualStep
      .mockRejectedValueOnce(new Error("retries exhausted"))
      .mockResolvedValueOnce([{ status: "failed", reason: "read_failed", transient: true }]);
    expect(await archiveManuals(["a", "b"])).toEqual({ archived: 2, skipped: 0, failed: 0, indexed: 0, indexFailed: 2, passagesBuilt: 0, passagesFailed: 0, questionsWritten: 0, questionsFailed: 0, skillsWritten: 0, skillsFailed: 0 });
  });

  it("writes eval questions for the documents whose passages were just built, and never lets that change the other counts", async () => {
    steps.archiveManualStep.mockResolvedValue({ status: "archived", reason: "archived" });
    steps.indexManualStep
      .mockResolvedValueOnce([
        { status: "indexed", documentStatus: "ready", passages: { status: "built", documentId: "d1" } },
        { status: "skipped", passages: { status: "skipped", documentId: "d2", reason: "up_to_date" } },
      ])
      .mockResolvedValueOnce([{ status: "indexed", documentStatus: "ready", passages: { status: "built", documentId: "d3" } }])
      .mockResolvedValueOnce([{ status: "indexed", documentStatus: "no_text" }]);
    steps.evalQuestionsStep
      .mockResolvedValueOnce([{ status: "written", documentId: "d1", questions: 4 }])
      .mockRejectedValueOnce(new Error("retries exhausted"));

    const result = await archiveManuals(["a", "b", "c"]);
    // Only built documents are asked about; a resource with none makes no call.
    expect(steps.evalQuestionsStep.mock.calls).toEqual([[["d1"]], [["d3"]]]);
    expect(result).toEqual({
      archived: 3,
      skipped: 0,
      failed: 0,
      indexed: 3,
      indexFailed: 0,
      passagesBuilt: 2,
      passagesFailed: 0,
      questionsWritten: 1,
      questionsFailed: 1,
      skillsWritten: 0,
      skillsFailed: 0,
    });
    // The skills tail asked once which tools to write for (the setting is off: none).
    expect(skills.toolSkillTargetsStep.mock.calls).toEqual([[[], ["d1", "d3"]]]);
    expect(skills.writeToolSkillStep).not.toHaveBeenCalled();
  });
});

describe("archiveManuals — the tool skills tail (tool skills spec 2026-10-07 §5.4)", () => {
  it("adds no step at all when nothing was built and no tool came from research", async () => {
    steps.archiveManualStep.mockResolvedValue({ status: "skipped", reason: "already_archived" });
    await archiveManuals(["a"]);
    expect(skills.toolSkillTargetsStep).not.toHaveBeenCalled();
  });

  it("with the setting off, writes nothing even for a tool just approved", async () => {
    steps.archiveManualStep.mockResolvedValue({ status: "skipped", reason: "already_archived" });
    const result = await archiveManuals(["a"], ["tool-1"]);
    expect(skills.toolSkillTargetsStep).toHaveBeenCalledWith(["tool-1"], []);
    expect(skills.writeToolSkillStep).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skillsWritten: 0, skillsFailed: 0 });
  });

  it("with the setting on, writes each target's skill as the pass after research, after the manuals, without forcing", async () => {
    steps.archiveManualStep.mockResolvedValue({ status: "archived", reason: "archived" });
    steps.indexManualStep.mockResolvedValueOnce([{ status: "indexed", documentStatus: "ready", passages: { status: "built", documentId: "d1" } }]);
    skills.toolSkillTargetsStep.mockResolvedValue(["tool-1", "tool-2", "tool-3"]);
    skills.writeToolSkillStep
      .mockResolvedValueOnce({ status: "written", toolId: "tool-1", version: 1 })
      .mockResolvedValueOnce({ status: "skipped", toolId: "tool-2", reason: "up_to_date" })
      .mockRejectedValueOnce(new Error("Tool skill: the model could not answer this minute."));

    const result = await archiveManuals(["a"], ["tool-1"]);
    expect(skills.toolSkillTargetsStep).toHaveBeenCalledWith(["tool-1"], ["d1"]);
    expect(skills.writeToolSkillStep.mock.calls).toEqual([
      ["tool-1", "research", false],
      ["tool-2", "research", false],
      ["tool-3", "research", false],
    ]);
    // A step that gave up stores one failed row with its reason.
    expect(skills.recordToolSkillFailureStep).toHaveBeenCalledWith("tool-3", "research", "Tool skill: the model could not answer this minute.");
    // The manual counts are untouched.
    expect(result).toMatchObject({ archived: 1, indexed: 1, passagesBuilt: 1, skillsWritten: 1, skillsFailed: 1 });
    // The skills ran before the run's last line.
    expect(skills.writeToolSkillStep.mock.invocationCallOrder.at(-1)!).toBeLessThan(steps.finishManualArchive.mock.invocationCallOrder[0]);
  });
});
