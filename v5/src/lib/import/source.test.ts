import { http, HttpResponse } from "msw";
import { flagsPage, notionQueryResponse, projectsPage } from "../../../test/fixtures/notion";
import { DB_IDS } from "../../../test/msw/handlers";
import { server } from "../../../test/msw/server";
import { readNotionSnapshot } from "./source";

function stubNotionEnv(withProjects = true) {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_TOOLS", DB_IDS.tools);
  vi.stubEnv("NOTION_DB_CATEGORIES", DB_IDS.categories);
  vi.stubEnv("NOTION_DB_LOCATIONS", DB_IDS.locations);
  vi.stubEnv("NOTION_DB_UNITS", DB_IDS.units);
  vi.stubEnv("NOTION_DB_RESOURCES", DB_IDS.resources);
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", DB_IDS.maintenance_logs);
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
  if (withProjects) vi.stubEnv("NOTION_DB_PROJECTS", DB_IDS.projects);
}

describe("readNotionSnapshot", () => {
  it("reads schemas and every database, drafts included, plus the email properties", async () => {
    stubNotionEnv();
    server.use(
      http.post(`https://api.notion.com/v1/databases/${DB_IDS.flags}/query`, () =>
        HttpResponse.json(notionQueryResponse([flagsPage]))
      ),
      http.post(`https://api.notion.com/v1/databases/${DB_IDS.projects}/query`, () =>
        HttpResponse.json(notionQueryResponse([projectsPage]))
      )
    );

    const lines: string[] = [];
    const snapshot = await readNotionSnapshot({ throttleMs: 0, log: (line) => lines.push(line) });

    expect(Object.keys(snapshot.schemas)).toEqual(["units", "maintenance_logs", "flags"]);
    expect(snapshot.schemas.units?.properties.status.select?.options.map((o) => o.name)).toContain("Retired");
    expect(snapshot.tools).toHaveLength(1);
    expect(snapshot.categories).toHaveLength(1);
    expect(snapshot.units).toHaveLength(1);
    expect(snapshot.maintenanceLogs[0].reporterEmail).toBeNull();
    expect(snapshot.flags[0].reporterEmail).toBe("ada@cornell.edu");
    expect(snapshot.projects[0].fields.title).toBe("Laser-cut lamp");
    expect(lines).toContain("read 1 tools");
  });

  it("leaves projects empty when NOTION_DB_PROJECTS is unset", async () => {
    stubNotionEnv(false);
    const snapshot = await readNotionSnapshot({ throttleMs: 0 });
    expect(snapshot.projects).toEqual([]);
  });
});
