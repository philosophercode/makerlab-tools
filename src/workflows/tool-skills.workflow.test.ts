import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { gatewayHandlers } from "../../test/gateway/msw";
import { promptText, textResponse } from "../../test/gateway/wire";
import { server } from "../../test/msw/server";
import { setLabSetting, TOOL_SKILLS_SETTING } from "../lib/data/lab-settings";
import { currentToolSkill } from "../lib/data/tool-skills";
import { getDb, resetDbForTests } from "../lib/db/client";
import { labSettings, tools, toolSkills } from "../lib/db/schema/index";
import { writeToolSkills } from "./tool-skills";

/**
 * `writeToolSkills` in process under `@workflow/vitest` (tool skills spec
 * 2026-10-07 §5.3, §5.4): the real step bundle writes the demo Form 4's skill
 * (it has lab notes, so there is something to write from) through the
 * Gateway's language endpoint, stubbed at its wire — `vi.mock` does not reach
 * step code. The setting gates the pass after research when the step runs; a
 * second pass finds the skill up to date and asks nothing; Write skill
 * (`manual`, forced) writes again.
 */

const ANSWER = JSON.stringify({
  quickFacts: [{ text: "A resin 3D printer", cites: ["T1"] }],
  operatingProcedure: [{ text: "Wear nitrile gloves before you touch the resin", cites: ["N1"] }],
  settingsAndLimits: [{ text: "Layer height 25 microns", cites: [] }],
});

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("writeToolSkills (in process)", () => {
  it("writes only when the lab has it on, once per change, and again when forced", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    vi.stubEnv("MODEL_SKILL_WRITE", "");
    vi.stubEnv("MODEL_SKILL_WRITE_TIER", "");
    for (const method of ["info", "warn"] as const) vi.spyOn(console, method).mockImplementation(() => {});

    const asked: { modelId: string; tier: unknown }[] = [];
    server.use(
      ...gatewayHandlers({
        language: (req) => {
          const body = req.body as { providerOptions?: { gateway?: { serviceTier?: unknown } } };
          asked.push({ modelId: req.modelId, tier: body.providerOptions?.gateway?.serviceTier });
          const prompt = promptText(req);
          expect(prompt).toContain("[T1] The lab's catalogue record");
          expect(prompt).toContain("[N1] Lab note for this machine");
          return textResponse(ANSWER);
        },
      })
    );

    const db = await getDb();
    await db.delete(toolSkills);
    await db.delete(labSettings);
    const [form] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));

    // Off (the default): the pass after research asks nothing and stores nothing.
    const off = await (await start(writeToolSkills, [[form.id], "research", false])).returnValue;
    expect(off).toEqual({ written: 0, skipped: 1, failed: 0 });
    expect(asked).toEqual([]);
    expect(await currentToolSkill(db, form.id)).toBeNull();

    // On: one call to job skillWrite (Opus, no tier hint), and a checked skill stored.
    await setLabSetting(TOOL_SKILLS_SETTING, { afterResearch: true }, null);
    const on = await (await start(writeToolSkills, [[form.id], "research", false])).returnValue;
    expect(on).toEqual({ written: 1, skipped: 0, failed: 0 });
    expect(asked).toEqual([{ modelId: "anthropic/claude-opus-5.5", tier: undefined }]);
    const row = await currentToolSkill(db, form.id);
    expect(row).toMatchObject({ version: 1, status: "ready", trigger: "research", model: "anthropic/claude-opus-5.5" });
    expect(row!.content).toContain("# Form 4: operating guide");
    // The numbers guard took out the uncited figure.
    expect(row!.content).not.toContain("25 microns");

    // Nothing changed: skipped, no call.
    const again = await (await start(writeToolSkills, [[form.id], "research", false])).returnValue;
    expect(again).toEqual({ written: 0, skipped: 1, failed: 0 });
    expect(asked).toHaveLength(1);

    // Write skill: forced, whatever the setting.
    await setLabSetting(TOOL_SKILLS_SETTING, { afterResearch: false }, null);
    const manual = await (await start(writeToolSkills, [[form.id], "manual", true])).returnValue;
    expect(manual).toEqual({ written: 1, skipped: 0, failed: 0 });
    expect(asked).toHaveLength(2);
    expect(await currentToolSkill(db, form.id)).toMatchObject({ version: 2, trigger: "manual" });
  });
});
