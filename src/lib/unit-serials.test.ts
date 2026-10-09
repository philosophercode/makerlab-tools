// @vitest-environment node
import { listCatalogTools } from "./data/catalog";
import { resetDbForTests } from "./db/client";
import { identityFor } from "../../test/utils/identities";
import type { Role } from "./auth/roles";
import {
  canSeeSerials,
  serialsForViewer,
  toolForViewer,
  unitsForViewer,
  withUnitSerials,
} from "./unit-serials";
import type { MakerLabTool } from "../components/catalog-types";

/**
 * Whole unit serials are staff-only; everyone else sees the last four
 * characters, masked (data platform spec amendment 2026-10-06). Against the
 * demo-seeded PGlite database: `Form 4 // A` (ML-F4-001, "•••• -001") and
 * `Trotec Speedy 400` (ML-LSR-400).
 */

const STAFF: Role[] = ["admin", "super_admin"];
const NOT_STAFF: Role[] = ["anonymous", "user"];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterAll(() => {
  resetDbForTests();
});

/** The public Form 4, as every catalogue read now gives it: units with only the masked last four. */
async function publicForm4(): Promise<MakerLabTool> {
  const tool = (await listCatalogTools()).find((t) => t.slug === "form-4");
  if (!tool) throw new Error("the demo seed has no form-4");
  return tool;
}

describe("canSeeSerials", () => {
  it.each(STAFF)("lets %s see serials", (role) => {
    expect(canSeeSerials(identityFor(role))).toBe(true);
  });

  it.each(NOT_STAFF)("does not let %s see serials", (role) => {
    expect(canSeeSerials(identityFor(role))).toBe(false);
  });

  it("does not let a missing identity see serials", () => {
    expect(canSeeSerials(null)).toBe(false);
    expect(canSeeSerials(undefined)).toBe(false);
  });
});

describe("serialsForViewer", () => {
  it("starts from a catalogue that carries no whole serials, only the masked last four", async () => {
    const tool = await publicForm4();
    expect(tool.units).toHaveLength(1);
    expect(tool.units[0]).not.toHaveProperty("serial");
    expect(tool.units[0].serialMasked).toBe("•••• -001");
  });

  it.each(STAFF)("reads the serials for %s", async (role) => {
    const tool = await publicForm4();
    const serials = await serialsForViewer(identityFor(role), [tool.units[0].id]);
    expect(Object.fromEntries(serials)).toEqual({ [tool.units[0].id]: "ML-F4-001" });
  });

  it.each(NOT_STAFF)("gives %s an empty map", async (role) => {
    const tool = await publicForm4();
    const serials = await serialsForViewer(identityFor(role), [tool.units[0].id]);
    expect(serials.size).toBe(0);
  });
});

describe("unitsForViewer and toolForViewer", () => {
  it.each(STAFF)("give %s every unit's whole serial, in place of the masked one", async (role) => {
    const tool = await publicForm4();
    const units = await unitsForViewer(identityFor(role), tool.units);
    expect(units.map((u) => u.serial)).toEqual(["ML-F4-001"]);
    expect(units[0]).not.toHaveProperty("serialMasked");
    const viewed = await toolForViewer(identityFor(role), tool);
    expect(viewed.units.map((u) => u.serial)).toEqual(["ML-F4-001"]);
    // The cached catalogue entry is never written to.
    expect(tool.units[0]).not.toHaveProperty("serial");
    expect(tool.units[0].serialMasked).toBe("•••• -001");
  });

  it.each(NOT_STAFF)("give %s the units with only the masked last four", async (role) => {
    const tool = await publicForm4();
    const units = await unitsForViewer(identityFor(role), tool.units);
    expect(units[0]).not.toHaveProperty("serial");
    expect(units[0].serialMasked).toBe("•••• -001");
    const viewed = await toolForViewer(identityFor(role), tool);
    expect(viewed).toBe(tool);
    expect(JSON.stringify(viewed)).not.toContain("ML-F4-001");
  });
});

describe("withUnitSerials", () => {
  it("sets the serials it has, dropping the masked ones, and leaves the other units as they were", () => {
    const units = [
      { id: "a", name: "A", serialMasked: "•••• -001" },
      { id: "b", name: "B", serialMasked: "•••• -002" },
    ];
    const merged = withUnitSerials(units, new Map([["a", "SN-0001"]]));
    expect(merged).toEqual([{ id: "a", name: "A", serial: "SN-0001" }, { id: "b", name: "B", serialMasked: "•••• -002" }]);
    expect(merged[1]).toBe(units[1]);
  });
});
