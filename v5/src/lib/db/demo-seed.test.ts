// @vitest-environment node
import { eq } from "drizzle-orm";
import { seedDemo } from "./demo-seed";
import { createPgliteDb } from "./pglite";
import { resources, tools, units } from "./schema/index";

describe("seedDemo", () => {
  it("inserts the two demo tools with their units and resources", async () => {
    const db = await createPgliteDb({ seed: seedDemo });

    const toolRows = await db.select().from(tools).orderBy(tools.slug);
    expect(toolRows.map((row) => row.name)).toEqual(["Form 4", "Trotec Speedy 400"]);
    expect(toolRows.every((row) => row.published)).toBe(true);

    const form4 = toolRows[0];
    const form4Units = await db.select().from(units).where(eq(units.toolId, form4.id));
    expect(form4Units).toHaveLength(1);
    expect(form4Units[0]).toMatchObject({ unitLabel: "Form 4 // A", status: "in_use", condition: "excellent" });

    const form4Resources = await db.select().from(resources).where(eq(resources.toolId, form4.id));
    expect(form4Resources.map((row) => row.title)).toEqual(["Form 4 SOP", "Resin handling safety"]);
  });

  it("is idempotent", async () => {
    const db = await createPgliteDb({ seed: seedDemo });
    await seedDemo(db);
    const toolRows = await db.select().from(tools);
    expect(toolRows).toHaveLength(2);
  });
});
