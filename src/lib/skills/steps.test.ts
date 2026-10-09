// @vitest-environment node

/**
 * The tool skill steps (tool skills spec 2026-10-07 §5.3, §5.4) as plain
 * functions: the writer, the setting and the targets are mocked, so what is
 * under test is the step's own rule — the setting read when the step runs,
 * the cap asked for every trigger but the backfill, only a transient model
 * failure or an unreachable database retried, and a failure stored after the
 * last retry.
 */

const writer = vi.hoisted(() => ({ writeToolSkill: vi.fn(), recordStepFailure: vi.fn() }));
vi.mock("./write", () => writer);
const setting = vi.hoisted(() => ({ skillsAfterResearch: vi.fn() }));
vi.mock("./setting", () => setting);
const targets = vi.hoisted(() => ({ toolIdsForDocuments: vi.fn() }));
vi.mock("./targets", () => targets);

import { FatalError, RetryableError } from "workflow";
import { SKILL_STEP_MAX_RETRIES } from "./limits";
import { recordToolSkillFailureStep, toolSkillTargetsStep, writeToolSkillStep } from "./steps";

const TOOL = "675596a3-081a-41a5-88e2-91353a18f759";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  writer.writeToolSkill.mockReset().mockResolvedValue({ status: "written", toolId: TOOL, version: 1 });
  writer.recordStepFailure.mockReset().mockResolvedValue(true);
  setting.skillsAfterResearch.mockReset().mockResolvedValue(true);
  targets.toolIdsForDocuments.mockReset().mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("writeToolSkillStep", () => {
  it("skips the pass after research when the setting is off when the step runs, asking nothing", async () => {
    setting.skillsAfterResearch.mockResolvedValue(false);
    expect(await writeToolSkillStep(TOOL, "research", false)).toEqual({ status: "skipped", toolId: TOOL, reason: "disabled" });
    expect(writer.writeToolSkill).not.toHaveBeenCalled();
  });

  it("writes a manual run whatever the setting, forced, under the cap", async () => {
    setting.skillsAfterResearch.mockResolvedValue(false);
    await writeToolSkillStep(TOOL, "manual", true);
    expect(writer.writeToolSkill).toHaveBeenCalledWith(expect.anything(), TOOL, { trigger: "manual", force: true, enforceCap: true });
  });

  it("asks the pass after research to respect the cap, unforced", async () => {
    await writeToolSkillStep(TOOL, "research", false);
    expect(writer.writeToolSkill).toHaveBeenCalledWith(expect.anything(), TOOL, { trigger: "research", force: false, enforceCap: true });
  });

  it("returns a permanent failure as it came, and retries a transient one", async () => {
    writer.writeToolSkill.mockResolvedValueOnce({ status: "failed", toolId: TOOL, reason: "unreadable", kind: null, transient: false, recorded: true });
    expect(await writeToolSkillStep(TOOL, "research", false)).toMatchObject({ status: "failed", reason: "unreadable" });

    writer.writeToolSkill.mockResolvedValueOnce({ status: "failed", toolId: TOOL, reason: "model", kind: "rate_limited", transient: true, recorded: false });
    expect(RetryableError.is(await writeToolSkillStep(TOOL, "research", false).catch((e: unknown) => e))).toBe(true);
  });

  it("retries an unreachable database and gives up on anything else", async () => {
    writer.writeToolSkill.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    expect(RetryableError.is(await writeToolSkillStep(TOOL, "manual", true).catch((e: unknown) => e))).toBe(true);
    writer.writeToolSkill.mockRejectedValueOnce(new Error("syntax error at or near"));
    expect(FatalError.is(await writeToolSkillStep(TOOL, "manual", true).catch((e: unknown) => e))).toBe(true);
  });

  it("sets maxRetries as a property on each step", () => {
    expect(writeToolSkillStep.maxRetries).toBe(SKILL_STEP_MAX_RETRIES);
    expect(toolSkillTargetsStep.maxRetries).toBe(SKILL_STEP_MAX_RETRIES);
    expect(recordToolSkillFailureStep.maxRetries).toBe(SKILL_STEP_MAX_RETRIES);
  });
});

describe("toolSkillTargetsStep", () => {
  it("answers no tools when the setting is off", async () => {
    setting.skillsAfterResearch.mockResolvedValue(false);
    expect(await toolSkillTargetsStep(["tool-1"], ["doc-1"])).toEqual([]);
    expect(targets.toolIdsForDocuments).not.toHaveBeenCalled();
  });

  it("answers the approved tools first, then the indexed documents' tools, each once", async () => {
    targets.toolIdsForDocuments.mockResolvedValue(["tool-2", "tool-1"]);
    expect(await toolSkillTargetsStep(["tool-1"], ["doc-1", "doc-2"])).toEqual(["tool-1", "tool-2"]);
    expect(targets.toolIdsForDocuments).toHaveBeenCalledWith(expect.anything(), ["doc-1", "doc-2"]);
  });
});

describe("recordToolSkillFailureStep", () => {
  it("stores one failed row with the step's reason", async () => {
    expect(await recordToolSkillFailureStep(TOOL, "research", "Tool skill: the model could not answer this minute.")).toBe(true);
    expect(writer.recordStepFailure).toHaveBeenCalledWith(expect.anything(), TOOL, "research", "Tool skill: the model could not answer this minute.");
  });
});
