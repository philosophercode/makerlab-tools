import { nextCacheMock } from "../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

// `src/lib/projects.ts` is now a thin `"use cache"` wrapper over
// `src/lib/data/projects.ts` (spec §3.10); the mapping and filtering it used
// to do live there and are covered by `src/lib/data/projects.test.ts`
// instead. This file only has to prove the wrapper: it delegates with the
// right arguments, tags every read `projects`, and — Article 4 — never turns
// a database failure into an invented empty result.
const dataProjects = vi.hoisted(() => ({
  listPublishedProjects: vi.fn(),
  findPublishedProject: vi.fn(),
  listPublishedProjectsForTool: vi.fn(),
}));

vi.mock("./data/projects", () => dataProjects);

import { cacheTag } from "next/cache";
import type { MakerLabProject } from "../components/catalog-types";
import { getProject, getProjectsForTool, getPublishedProjects } from "./projects";

function project(overrides: Partial<MakerLabProject> = {}): MakerLabProject {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "lamp-from-scrap-plywood",
    title: "Lamp from scrap plywood",
    author: "Ada Lovelace",
    body: "## How I made it",
    photos: ["https://blob.test/cover.png"],
    tools: [{ id: "tool-1", name: "Form 4", slug: "form-4" }],
    link: null,
    materials: ["Plywood"],
    date: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  dataProjects.listPublishedProjects.mockReset();
  dataProjects.findPublishedProject.mockReset();
  dataProjects.listPublishedProjectsForTool.mockReset();
});

describe("getPublishedProjects", () => {
  it("returns what the data layer resolves", async () => {
    dataProjects.listPublishedProjects.mockResolvedValue([project()]);

    expect(await getPublishedProjects()).toEqual([project()]);
    expect(dataProjects.listPublishedProjects).toHaveBeenCalledTimes(1);
  });

  it("tags the read `projects`, so publishing or unpublishing one can invalidate it", async () => {
    dataProjects.listPublishedProjects.mockResolvedValue([]);

    await getPublishedProjects();
    expect(vi.mocked(cacheTag)).toHaveBeenCalledWith("projects");
  });

  it("lets a database failure propagate instead of returning an invented empty gallery", async () => {
    dataProjects.listPublishedProjects.mockRejectedValue(new Error("db unavailable"));

    await expect(getPublishedProjects()).rejects.toThrow("db unavailable");
  });
});

describe("getProject", () => {
  it("delegates to findPublishedProject with the id or slug it was given", async () => {
    dataProjects.findPublishedProject.mockResolvedValue(project());

    expect(await getProject("lamp-from-scrap-plywood")).toEqual(project());
    expect(dataProjects.findPublishedProject).toHaveBeenCalledWith("lamp-from-scrap-plywood");
  });

  it("returns null when the data layer finds nothing published under that id or slug", async () => {
    dataProjects.findPublishedProject.mockResolvedValue(null);

    expect(await getProject("no-such-project")).toBeNull();
  });

  it("tags the read `projects`", async () => {
    dataProjects.findPublishedProject.mockResolvedValue(null);

    await getProject("project-1");
    expect(vi.mocked(cacheTag)).toHaveBeenCalledWith("projects");
  });

  it("lets a database failure propagate", async () => {
    dataProjects.findPublishedProject.mockRejectedValue(new Error("db unavailable"));

    await expect(getProject("project-1")).rejects.toThrow("db unavailable");
  });
});

describe("getProjectsForTool", () => {
  it("delegates to listPublishedProjectsForTool with the given tool id", async () => {
    dataProjects.listPublishedProjectsForTool.mockResolvedValue([project()]);

    expect(await getProjectsForTool("tool-1")).toEqual([project()]);
    expect(dataProjects.listPublishedProjectsForTool).toHaveBeenCalledWith("tool-1");
  });

  it("returns an empty array when nothing was built with the tool", async () => {
    dataProjects.listPublishedProjectsForTool.mockResolvedValue([]);

    expect(await getProjectsForTool("tool-1")).toEqual([]);
  });

  it("lets a database failure propagate", async () => {
    dataProjects.listPublishedProjectsForTool.mockRejectedValue(new Error("db unavailable"));

    await expect(getProjectsForTool("tool-1")).rejects.toThrow("db unavailable");
  });
});
