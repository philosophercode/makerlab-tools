import { can, canReachAdmin } from "../auth/permissions";
import type { Role } from "../auth/roles";
import {
  ADMIN_SECTIONS,
  ADMIN_SURFACES,
  COUNT_LOADERS,
  SURFACE_KEYS,
  countLoadersFor,
  currentHref,
  currentSection,
  mayOpen,
  sectionsFor,
  surfacesFor,
} from "./surfaces";

/**
 * The one list of admin surfaces (UI system spec §8.1; admin sections spec
 * 2026-10-07): what each role is shown, the six sections it falls in, and
 * that the list, the gate and the pages agree. The section bar, the tabs
 * under each header, the overview and the ⌘K palette all read `surfacesFor`,
 * so these cases are the "nobody sees a surface that would refuse them"
 * guarantee for all of them.
 */

const keys = (role: Role) => surfacesFor({ role }).map((surface) => surface.key);
const sectionLinks = (role: Role) => sectionsFor(surfacesFor({ role }));

describe("surfacesFor — who is shown what", () => {
  it.each(["anonymous", "user"] as const)("shows %s nothing", (role) => {
    expect(keys(role)).toEqual([]);
  });

  it("shows nothing for a missing identity", () => {
    expect(surfacesFor(null)).toEqual([]);
    expect(surfacesFor(undefined)).toEqual([]);
    expect(surfacesFor({ role: null })).toEqual([]);
  });

  it("shows an admin (a SuperMaker) everything but the roster", () => {
    expect(keys("admin")).toEqual([
      "maintenance",
      "checklist",
      "schedules",
      "inventory",
      "intake",
      "qr",
      "labNotes",
      "research",
      "refresh",
      "taxonomy",
      "corrections",
      "projects",
      "insights",
      "settings",
      "mirror",
      "proposals",
      "agents",
    ]);
  });

  it("shows a super admin every surface, the roster included", () => {
    expect(keys("super_admin")).toEqual([...SURFACE_KEYS]);
  });

  it.each(["anonymous", "user", "admin", "super_admin"] as const)(
    "never lists a surface %s's own permission would refuse",
    (role) => {
      for (const surface of surfacesFor({ role })) expect(mayOpen({ role }, surface)).toBe(true);
      for (const surface of ADMIN_SURFACES.filter((entry) => !keys(role).includes(entry.key))) {
        expect(mayOpen({ role }, surface)).toBe(false);
      }
    }
  );
});

describe("the six sections (owner's decisions, 2026-10-07)", () => {
  it("are Overview, Maintenance, Inventory, People, Insights and Settings, in that order", () => {
    expect([...ADMIN_SECTIONS]).toEqual(["overview", "maintenance", "inventory", "people", "insights", "settings"]);
  });

  it("puts every surface in a section other than Overview, and every section other than Overview has one", () => {
    for (const surface of ADMIN_SURFACES) expect(ADMIN_SECTIONS.filter((s) => s !== "overview")).toContain(surface.section);
    for (const section of ADMIN_SECTIONS.filter((s) => s !== "overview")) {
      expect(ADMIN_SURFACES.some((surface) => surface.section === section)).toBe(true);
    }
  });

  it("gives a director all six, each opening its first surface", () => {
    expect(sectionLinks("super_admin")).toEqual([
      { section: "overview", href: "/admin" },
      { section: "maintenance", href: "/admin/maintenance" },
      { section: "inventory", href: "/admin/inventory" },
      { section: "people", href: "/admin/users" },
      { section: "insights", href: "/admin/insights" },
      { section: "settings", href: "/admin/settings" },
    ]);
  });

  it("opens a SuperMaker's People on Student projects, never the roster that would refuse them", () => {
    expect(sectionLinks("admin").find((link) => link.section === "people")?.href).toBe("/admin/projects");
  });

  it("leaves out a section the viewer has nothing in", () => {
    const items = surfacesFor({ role: "admin" }).filter((item) => item.section !== "insights");
    expect(sectionsFor(items).map((link) => link.section)).not.toContain("insights");
  });

  it("keeps the review's homes: QR labels and lab notes in Inventory, the checklist in Maintenance, MCP and AI agents in Settings", () => {
    const sectionOf = (key: string) => ADMIN_SURFACES.find((surface) => surface.key === key)?.section;
    expect(sectionOf("qr")).toBe("inventory");
    expect(sectionOf("labNotes")).toBe("inventory");
    expect(sectionOf("corrections")).toBe("inventory");
    expect(sectionOf("checklist")).toBe("maintenance");
    expect(sectionOf("schedules")).toBe("maintenance");
    expect(sectionOf("projects")).toBe("people");
    expect(sectionOf("proposals")).toBe("settings");
    expect(sectionOf("agents")).toBe("settings");
    expect(sectionOf("mirror")).toBe("settings");
  });
});

describe("the list itself", () => {
  it("has one entry per key, each with its own href, and only known count loaders", () => {
    expect(ADMIN_SURFACES.map((surface) => surface.key)).toEqual([...SURFACE_KEYS]);
    expect(new Set(ADMIN_SURFACES.map((surface) => surface.href)).size).toBe(ADMIN_SURFACES.length);
    for (const surface of ADMIN_SURFACES) {
      if (surface.count) expect(COUNT_LOADERS).toContain(surface.count);
      expect(surface.href.startsWith("/admin/")).toBe(true);
    }
  });

  it("keeps every address the admin had before the sections, so old links still open their page", () => {
    const hrefs = ADMIN_SURFACES.map((surface) => surface.href);
    for (const old of [
      "/admin/intake",
      "/admin/inventory",
      "/admin/inventory/qr",
      "/admin/inventory/lab-notes",
      "/admin/refresh",
      "/admin/research",
      "/admin/taxonomy",
      "/admin/insights",
      "/admin/maintenance",
      "/admin/maintenance/schedules",
      "/admin/corrections",
      "/admin/projects",
      "/admin/proposals",
      "/admin/users",
      "/admin/mirror",
    ]) {
      expect(hrefs).toContain(old);
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

describe("Add equipment is the one surface for adding equipment (amendment 2026-09-25)", () => {
  it("has no Import a list surface of its own", () => {
    expect(SURFACE_KEYS).not.toContain("import");
    expect(ADMIN_SURFACES.some((surface) => surface.href.startsWith("/admin/intake/imports"))).toBe(false);
  });

  it("reads the imports count only for a viewer who may import", () => {
    expect(countLoadersFor({ role: "admin" })).toContain("imports");
    expect(countLoadersFor({ role: "super_admin" })).toContain("imports");
    expect(countLoadersFor({ role: "user" })).toEqual([]);
    expect(countLoadersFor({ role: "anonymous" })).toEqual([]);
  });

  it("gates each extra count on the permission it names", () => {
    for (const surface of ADMIN_SURFACES) {
      for (const extra of surface.alsoCounts ?? []) {
        expect(COUNT_LOADERS).toContain(extra.loader);
        for (const role of ["admin", "super_admin"] as const) {
          expect(countLoadersFor({ role }).includes(extra.loader)).toBe(can({ role }, extra.permission));
        }
      }
    }
  });

  it("does not count the people table for a SuperMaker", () => {
    expect(countLoadersFor({ role: "admin" })).not.toContain("users");
    expect(countLoadersFor({ role: "super_admin" })).toContain("users");
  });
});

describe("currentHref and currentSection — where a path is", () => {
  const hrefs = ["/admin", ...ADMIN_SURFACES.map((surface) => surface.href)];
  const items = surfacesFor({ role: "super_admin" });

  it("marks Add equipment on the queue, an item, the imports, Import a list and an import's review", () => {
    expect(currentHref("/admin/intake/imports", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake/imports/new", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake/abc", hrefs)).toBe("/admin/intake");
    expect(currentHref("/admin/intake/imports/abc", hrefs)).toBe("/admin/intake");
  });

  it("tells a tab from the page whose path is its prefix", () => {
    expect(currentHref("/admin/inventory/qr", hrefs)).toBe("/admin/inventory/qr");
    expect(currentHref("/admin/maintenance/checklist", hrefs)).toBe("/admin/maintenance/checklist");
    expect(currentHref("/admin/settings/ai-agents", hrefs)).toBe("/admin/settings/ai-agents");
  });

  it("puts each page in its section", () => {
    expect(currentSection("/admin", items)).toBe("overview");
    expect(currentSection("/admin/inventory/qr", items)).toBe("inventory");
    expect(currentSection("/admin/corrections", items)).toBe("inventory");
    expect(currentSection("/admin/maintenance/schedules", items)).toBe("maintenance");
    expect(currentSection("/admin/projects", items)).toBe("people");
    expect(currentSection("/admin/insights/value", items)).toBe("insights");
    expect(currentSection("/admin/proposals", items)).toBe("settings");
    expect(currentSection("/admin/settings/ai-agents", items)).toBe("settings");
    expect(currentSection("/admin/unknown", items)).toBeNull();
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
