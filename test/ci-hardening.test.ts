// @vitest-environment node
/**
 * CI supply-chain hardening (operational hardening spec, amendment
 * 2026-10-05): every action pinned to a commit SHA, checkout without a
 * persisted token, and Dependabot keeping the pins current.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const workflows = readdirSync(fileURLToPath(new URL("../.github/workflows/", import.meta.url))).filter((f) => /\.ya?ml$/.test(f));

describe.each(workflows)("workflow %s", (file) => {
  const ci = read(`.github/workflows/${file}`);
  const steps = ci.split(/\n(?=\s*- )/);

  it("pins every action to a full commit SHA", () => {
    const uses = [...ci.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it("checks out without persisting the token", () => {
    const checkouts = steps.filter((step) => /uses:\s*actions\/checkout@/.test(step));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) expect(step).toMatch(/persist-credentials:\s*false/);
  });
});

describe("CI hardening", () => {
  it("covers more than one workflow", () => {
    expect(workflows).toEqual(expect.arrayContaining(["ci.yml", "deploy-smoke.yml"]));
  });

  it("has Dependabot keep the pinned actions current", () => {
    expect(read(".github/dependabot.yml")).toMatch(/package-ecosystem:\s*github-actions/);
  });
});
