import en from "../../../messages/en.json";
import { MIRROR_ENTITY, MIRROR_STATUS } from "../../lib/db/schema/vocabulary";
import { MIRROR_ERROR_CODES, MIRROR_SETUP_ERRORS, type MappingProblem } from "../../lib/mirror/types";
import { mirrorErrorMessageKey } from "../../app/admin/mirror/action-result";

/**
 * Every code the mirror can answer has a sentence (Article 6, spec §6).
 *
 * The page renders codes, never English from the server: a setup refusal from
 * `admin.mirror.errors.<code>`, a stored push error from
 * `admin.mirror.lastError.<code>`. A code added to either vocabulary without a
 * key would render as the raw key path on the one page whose job is to explain
 * what went wrong — so this fails first.
 */

type Tree = { [key: string]: string | Tree };

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], en as unknown as Tree);
}

function expectMessage(path: string) {
  const value = lookup(path);
  expect(typeof value, `messages/en.json is missing "${path}"`).toBe("string");
  expect((value as string).trim(), `"${path}" is empty`).not.toBe("");
}

describe("the mirror's messages", () => {
  it.each(MIRROR_SETUP_ERRORS)("has admin.mirror.errors.%s", (code) => {
    expectMessage(`admin.mirror.errors.${code}`);
    expect(mirrorErrorMessageKey(code)).toBe(`mirror.errors.${code}`);
  });

  it.each(MIRROR_ERROR_CODES)("has admin.mirror.lastError.%s", (code) => {
    expectMessage(`admin.mirror.lastError.${code}`);
  });

  it("has a name for every mirrored table and every push result", () => {
    for (const entity of MIRROR_ENTITY) expectMessage(`admin.mirror.entities.${entity}`);
    for (const status of MIRROR_STATUS) expectMessage(`admin.mirror.status.result.${status}`);
  });

  it("has a sentence for every mapping problem", () => {
    const codes: MappingProblem["code"][] = ["invalid_database_id", "database_not_found", "schema_mismatch"];
    for (const code of codes) expectMessage(`admin.mirror.mapping.problems.${code}`);
  });

  it("renders the gate's codes from the errors every admin surface shares", () => {
    for (const code of ["not_signed_in", "not_permitted", "rate_limited", "failed", "invalid_field"] as const) {
      expect(mirrorErrorMessageKey(code)).toBe(`errors.${code}`);
      expectMessage(`admin.errors.${code}`);
    }
  });

  it("lists the mirror on /admin with a title and a lede that take no argument", () => {
    // `/admin/page.tsx` renders every lede without arguments (Article 6).
    expectMessage("admin.mirrorTitle");
    expectMessage("admin.mirrorLede");
    expect(lookup("admin.mirrorLede")).not.toMatch(/[{}]/);
  });

  it("puts no placeholder in a refusal, which is rendered without arguments", () => {
    for (const code of MIRROR_SETUP_ERRORS) expect(lookup(`admin.mirror.errors.${code}`)).not.toMatch(/[{}]/);
    for (const code of MIRROR_ERROR_CODES) expect(lookup(`admin.mirror.lastError.${code}`)).not.toMatch(/[{}]/);
  });

  it("no longer promises the mirror for a later phase", () => {
    expect(lookup("admin.indexMoreComing")).toBeUndefined();
  });
});
