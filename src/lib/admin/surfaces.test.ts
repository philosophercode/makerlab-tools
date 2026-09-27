import { can, canReachAdmin } from "../auth/permissions";
import type { Role } from "../auth/roles";
import { ADMIN_GROUPS, ADMIN_SURFACES, COUNT_LOADERS, SURFACE_KEYS, countLoadersFor, currentHref, surfacesFor } from "./surfaces";

/**
 * The one list of admin surfaces (UI system spec §8.1): what each role is
 * shown, and that the list, the gate and the pages agree. The home tiles, the
 * section bar and the ⌘K palette all read `surfacesFor`, so these cases are
 * the "nobody sees a surface that would refuse them" guarantee for all three.
 */

const keys = (role: Role) => surfacesFor({ role }).map((surface) => surface.key);

describe("surfacesFor — who is shown what", () => {
  it.each(["anonymous", "user"] as const)("shows %s nothing", (role) => {
    expect(keys(role)).toEqual([]);
  });

  it("shows nothing for a missing identity", () => {
    expect(surfacesFor(null)).toEqual([]);
    expect(surfacesFor(undefined)).toEqual([]);
    expect(surfacesFor({ role: null })).toEqual([]);
  });

  it("shows an admin (a SuperMaker) everything but People", () => {
    expect(keys("admin")).toEqual([
      "intake",
      "inventory",
      "refresh",
      "research",
      "maintenance",
      "corrections",
      "projects",
      "mirror",
    ]);
  });

  it("shows a super admin every surface, People included", () => {
    expect(keys("super_admin")).toEqual([...SURFACE_KEYS]);
  });

  it.each(["anonymous", "user", "admin", "super_admin"] as const)(
    "never lists a surface %s's own permission would refuse",
    (role) => {
      for (const surface of surfacesFor({ role })) expect(can({ role }, surface.permission)).toBe(true);
      for (const surface of ADMIN_SURFACES.filter((entry) => !keys(role).includes(entry.key))) {
        expect(can({ role }, surface.permission)).toBe(false);
      }
    }
  );
});

describe("the list itself", () => {
  it("has one entry per key, each in a known group, with its own href and count loader", () => {
    expect(ADMIN_SURFACES.map((surface) => surface.key)).toEqual([...SURFACE_KEYS]);
    expect(new Set(ADMIN_SURFACES.map((surface) => surface.href)).size).toBe(ADMIN_SURFACES.length);
    for (const surface of ADMIN_SURFACES) {
      expect(ADMIN_GROUPS).toContain(surface.group);
      expect(COUNT_LOADERS).toContain(surface.count);
      expect(surface.href.startsWith("/admin/")).toBe(true);
    }
  });

  it.each(["anonymous", "user", "admin", "super_admin"] as const)(
    "lists %s nothing the admin layout would refuse first",
    (role) => {
      // A surface shown to someone the layout turns away would be a link to a
      // refusal.
      if (surfacesFor({ role }).length > 0) expect(canReachAdmin({ role })).toBe(true);
    }
  );
});

describe("Intake is the one surface for adding equipment (amendment 2026-09-25)", () => {
  it("has no Import a list surface of its own", () => {
    expect(SURFACE_KEYS).not.toContain("import");
    expect(ADMIN_SURFACES.some((surface) => surface.href.startsWith("/admin/intake/imports"))).toBe(false);
    expect(ADMIN_SURFACES.filter((surface) => surface.group === "addEquipment").map((surface) => surface.key)).toEqual(["intake"]);
  });

  it("reads the imports count for Intake's tile only for a viewer who may import", () => {
    expect(countLoadersFor({ role: "admin" })).toContain("imports");
    expect(countLoadersFor({ role: "super_admin" })).toContain("imports");
    expect(countLoadersFor({ role: "user" })).toEqual([]);
    expect(countLoadersFor({ role: "anonymous" })).toEqual([]);
  });

  it("gates each extra count on the permission it names", () => {
    for (const surface of ADMIN_SURFACES) {
      for (const extra of surface.alsoCounts ?? []) {
        expect(COUNT_LOADERS).toContain(extra.loader);
        // Every role that sees the surface and holds the extra's permission reads it.
        for (const role of ["admin", "super_admin"] as const) {
          expect(countLoadersFor({ role }).includes(extra.loader)).toBe(can({ role }, extra.permission));
        }
      }
    }
  });
});

describe("currentHref — the most specific surface a path is on", () => {
  const hrefs = ["/admin", ...ADMIN_SURFACES.map((surface) => surface.href)];

  it("marks Intake on the queue, an item, the imports, Import a list and an import's review", () => {
    expect(currentHref("/admin/intake/imports", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake/imports/new", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake/abc", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake/imports/abc", hrefs)).toBe("/admin/intake");
  });

  it("marks Overview only on the home itself", () => {
    expect(currentHref("/admin", hrefs)).toBe("/admin");
    expect(currentHref("/admin/", hrefs)).toBe("/admin");
    expect(currentHref("/admin/unknown", hrefs)).toBeNull();
  });

  it("does not match a surface whose href is only a string prefix", () => {
    expect(currentHref("/admin/refreshments", hrefs)).toBeNull();
  });
});
