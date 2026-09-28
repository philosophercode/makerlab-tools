// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { listPublishedProjects } from "../src/lib/data/projects.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import { openPersistentPglite, type PersistentPglite } from "../src/lib/db/pglite.ts";
import { attachments, projectTools, projects, tools } from "../src/lib/db/schema/index.ts";
import type { BlobUploader } from "../src/lib/import/files.ts";
import { openImportTarget } from "../src/lib/import/target.ts";
import { seedProjects } from "../src/lib/projects-seed/apply.ts";
import { loadSeedBundle, type SeedBundle } from "../src/lib/projects-seed/bundle.ts";
import { parseArgs } from "./seed-projects.ts";

/**
 * `npm run projects:seed` against a fresh PGlite in a temp directory (never
 * the developer's `.pglite-data`), with an in-memory Blob uploader.
 */

const PAGE_A = "3c1bf30d-e857-80e7-a17a-f4039061e6f6";
const PAGE_B = "3c0bf30d-e857-8099-a103-fc67a2f66a55";

function fixtureBundle(): SeedBundle {
  const source = { notionAttachment: "attachment:x:y.png", blockId: PAGE_A, property: "Attach file", url: "https://example.notion.site/image/x" };
  return {
    source: { name: "Fixture", url: "https://example.notion.site/db" },
    projects: [
      {
        notionPageId: PAGE_A,
        slug: "smart-glove",
        title: "Smart Glove",
        credit: "MakerLAB · ADAPT Community Network",
        partnerOrg: { label: "ADAPT Community Network", url: "https://adaptcommunitynetwork.org/" },
        year: null,
        link: "https://example.com/glove",
        notionText: "Original text.",
        description: "**Smart Glove** is a wearable manual.",
        materials: ["Glove", "NFC tags"],
        tools: [
          { slug: "form-4", confidence: "medium", reason: "fixture" },
          { slug: "not-in-catalogue", confidence: "low", reason: "fixture" },
        ],
        images: [
          { file: "glove-1.jpg", alt: "one", source },
          { file: "glove-2.jpg", alt: "two", source },
        ],
      },
      {
        notionPageId: PAGE_B,
        slug: "tidal-sensor",
        title: "Tidal Sensor",
        credit: "MakerLAB · Solar One",
        partnerOrg: { label: "Solar One", url: null },
        year: null,
        link: null,
        notionText: "Original text.",
        description: "A tide gauge.",
        materials: [],
        tools: [],
        images: [{ file: "tidal-1.jpg", alt: "one", source }],
      },
    ],
  };
}

function memoryUploader() {
  const puts: string[] = [];
  const uploader: BlobUploader = {
    async put(pathname, _body, options) {
      const stored = `${pathname}-${puts.length}`;
      puts.push(stored);
      expect(options.access).toBe("public");
      return { pathname: stored, url: `https://blob.test/${stored}` };
    },
  };
  return { uploader, puts };
}

async function writeImage(dir: string, file: string, color: string) {
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: color } }).jpeg().toBuffer();
  await writeFile(join(dir, file), bytes);
}

let root: string;
let imagesDir: string;
let local: PersistentPglite;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "projects-seed-"));
  imagesDir = join(root, "images");
  await mkdir(imagesDir);
  await writeImage(imagesDir, "glove-1.jpg", "#ff0000");
  await writeImage(imagesDir, "glove-2.jpg", "#00ff00");
  await writeImage(imagesDir, "tidal-1.jpg", "#0000ff");
  local = await openPersistentPglite(join(root, "db"));
  await local.db.insert(tools).values({ slug: "form-4", name: "Form 4", published: true });
});

afterEach(async () => {
  await local.close();
  await rm(root, { recursive: true, force: true });
});

describe("seedProjects", () => {
  it("creates published projects with the first photo as cover, tools linked by slug and materials stored", async () => {
    const { uploader, puts } = memoryUploader();
    const report = await seedProjects({ db: local.db, bundle: fixtureBundle(), imagesDir, uploader });

    expect(report.projects.map((p) => p.action)).toEqual(["create", "create"]);
    expect(report.projects[0].toolsMissing).toEqual(["not-in-catalogue"]);
    expect(puts).toHaveLength(3);

    const gallery = await listPublishedProjects({ db: local.db });
    // Bundle order survives the newest-first gallery.
    expect(gallery.map((p) => p.slug)).toEqual(["smart-glove", "tidal-sensor"]);
    const glove = gallery[0];
    expect(glove.author).toBe("MakerLAB · ADAPT Community Network");
    expect(glove.photos[0]).toContain("uploads/project/glove-1.jpg");
    expect(glove.photos).toHaveLength(2);
    expect(glove.tools.map((t) => t.slug)).toEqual(["form-4"]);
    expect(glove.materials).toEqual(["Glove", "NFC tags"]);
    expect(glove.body).toContain("**Partner:** [ADAPT Community Network](https://adaptcommunitynetwork.org/)");

    const [row] = await local.db.select().from(projects).where(eq(projects.slug, "smart-glove"));
    expect(row.notionPageId).toBe(PAGE_A);
    expect(row.published).toBe(true);
    expect(row.publishedAt).not.toBeNull();
    const photos = await local.db.select().from(attachments).where(eq(attachments.ownerId, row.id));
    expect(photos.every((p) => p.sourceKey?.startsWith(`projects-seed:${PAGE_A}:`) && p.origin === "import")).toBe(true);
    expect(photos.find((p) => p.position === 0)?.width).toBe(8);
  });

  it("is idempotent: a re-run updates the same rows and uploads nothing", async () => {
    const { uploader, puts } = memoryUploader();
    await seedProjects({ db: local.db, bundle: fixtureBundle(), imagesDir, uploader });
    const before = await local.db.select({ id: projects.id, publishedAt: projects.publishedAt }).from(projects);

    const edited = fixtureBundle();
    edited.projects[0].title = "Smart Glove v2";
    const report = await seedProjects({ db: local.db, bundle: edited, imagesDir, uploader });

    expect(report.projects.map((p) => p.action)).toEqual(["update", "update"]);
    expect(puts).toHaveLength(3);
    const after = await local.db.select({ id: projects.id, publishedAt: projects.publishedAt, title: projects.title }).from(projects);
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.find((r) => r.title === "Smart Glove v2")).toBeDefined();
    expect((await local.db.select().from(attachments)).length).toBe(3);
    expect((await local.db.select().from(projectTools)).length).toBe(1);
  });

  it("re-uploads a changed photo and detaches the old one for the cron to sweep", async () => {
    const { uploader, puts } = memoryUploader();
    await seedProjects({ db: local.db, bundle: fixtureBundle(), imagesDir, uploader });
    await writeImage(imagesDir, "tidal-1.jpg", "#ffff00");

    const report = await seedProjects({ db: local.db, bundle: fixtureBundle(), imagesDir, uploader });
    expect(report.projects[1]).toMatchObject({ photosUploaded: 1, photosDetached: 1 });
    expect(puts).toHaveLength(4);
    const owned = await local.db.select().from(attachments).where(eq(attachments.ownerType, "project"));
    expect(owned).toHaveLength(3);
  });

  it("--dry-run reports and writes nothing", async () => {
    const report = await seedProjects({ db: local.db, bundle: fixtureBundle(), imagesDir, uploader: null, dryRun: true });
    expect(report.projects.map((p) => [p.action, p.photosUploaded])).toEqual([
      ["create", 2],
      ["create", 1],
    ]);
    expect(await local.db.select().from(projects)).toHaveLength(0);
    expect(await local.db.select().from(attachments)).toHaveLength(0);
  });

  it("takes the next free slug when a different project already has it", async () => {
    await local.db.insert(projects).values({ slug: "smart-glove", title: "Someone else's glove" });
    const { uploader } = memoryUploader();
    const report = await seedProjects({ db: local.db, bundle: fixtureBundle(), imagesDir, uploader });
    expect(report.projects[0].slug).toBe("smart-glove-2");
  });
});

describe("the local database lock", () => {
  it("refuses to open a PGlite directory another running process holds", async () => {
    const dir = join(root, "held");
    await mkdir(dir);
    // The parent process (vitest's runner) is alive and is not us.
    await writeFile(join(dir, "lock"), String(process.ppid));
    await expect(openImportTarget({ kind: "pglite-local", dir })).rejects.toBeInstanceOf(PgliteLockedError);
  });
});

describe("the committed bundle", () => {
  it("validates, and every image it names is in images/", () => {
    const dir = resolve(import.meta.dirname, "../data/projects-seed");
    const bundle = loadSeedBundle(dir);
    expect(bundle.projects.length).toBeGreaterThan(0);
    for (const project of bundle.projects) {
      expect(project.images.length).toBeGreaterThan(0);
      for (const image of project.images) expect(existsSync(join(dir, "images", image.file))).toBe(true);
    }
  });
});

describe("parseArgs", () => {
  it("reads --dry-run and --bundle, and refuses anything else", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true, bundleDir: "data/projects-seed" });
    expect(parseArgs(["--bundle", "x"]).bundleDir).toBe("x");
    expect(() => parseArgs(["--force"])).toThrow(/Unknown argument/);
  });
});
