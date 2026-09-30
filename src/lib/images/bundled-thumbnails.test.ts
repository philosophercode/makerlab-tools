// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Canvas } from "../../../test/images/synthetic";
import { generateBundledThumbnails, manifestSource } from "./bundled-thumbnails";

/**
 * The bundled-photo thumbnail script (`npm run thumbnails:bundled`) against a
 * temporary folder: what it writes, that a second run renders nothing, that
 * `--check` notices a changed photo, and that it never deletes.
 */

function setup() {
  const root = mkdtempSync(join(tmpdir(), "bundled-thumbs-"));
  const sourceDir = join(root, "tool-images");
  const outDir = join(sourceDir, "thumbs");
  const manifestPath = join(root, "bundled-tool-thumbnails.ts");
  return { root, sourceDir, outDir, manifestPath, urlPrefix: "/tool-images/thumbs" };
}

async function writePhoto(dir: string, name: string, colour: [number, number, number, number]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), await new Canvas(800, 400, [0, 0, 0, 0]).rect(100, 100, 600, 200, colour).png({ alpha: true }));
}

describe("generateBundledThumbnails", () => {
  it("writes content-hashed thumbnails for every photo and a manifest keyed by file name", async () => {
    const dirs = setup();
    await writePhoto(dirs.sourceDir, "Form 4", [200, 80, 20, 255]);
    await writePhoto(dirs.sourceDir, "DEWALT 12V_20V Charger", [20, 80, 200, 255]);

    const report = await generateBundledThumbnails(dirs);
    expect(report).toMatchObject({ photos: 2, failed: [], stale: [] });
    expect(report.rendered.sort()).toEqual(["DEWALT 12V_20V Charger", "Form 4"]);

    const files = readdirSync(dirs.outDir).sort();
    expect(files).toHaveLength(12); // 2 photos × 3 widths × 2 formats
    expect(files.every((f) => /^(form-4|dewalt-12v-20v-charger)\.[0-9a-f]{12}\.(160|320|640)\.(avif|webp)$/.test(f))).toBe(true);

    const manifest = readFileSync(dirs.manifestPath, "utf8");
    expect(manifest).toContain('"Form 4": {"base":"/tool-images/thumbs/form-4.');
    expect(manifest).toContain('"widths":[160,320,640],"width":800,"height":400');
  });

  it("renders nothing on a second run, and --check then says it is up to date", async () => {
    const dirs = setup();
    await writePhoto(dirs.sourceDir, "Form 4", [200, 80, 20, 255]);
    await generateBundledThumbnails(dirs);

    const again = await generateBundledThumbnails(dirs);
    expect(again.rendered).toEqual([]);
    expect(again.upToDate).toBe(true);
    expect((await generateBundledThumbnails({ ...dirs, check: true })).upToDate).toBe(true);
  });

  it("notices a replaced photo under --check without writing, and lists (never deletes) the old files", async () => {
    const dirs = setup();
    await writePhoto(dirs.sourceDir, "Form 4", [200, 80, 20, 255]);
    await generateBundledThumbnails(dirs);
    const before = readdirSync(dirs.outDir).sort();

    await writePhoto(dirs.sourceDir, "Form 4", [10, 200, 10, 255]);
    const checked = await generateBundledThumbnails({ ...dirs, check: true });
    expect(checked.upToDate).toBe(false);
    expect(checked.rendered).toEqual(["Form 4"]);
    expect(readdirSync(dirs.outDir).sort()).toEqual(before);

    const rerun = await generateBundledThumbnails(dirs);
    expect(rerun.rendered).toEqual(["Form 4"]);
    expect(rerun.stale.sort()).toEqual(before);
    for (const file of before) expect(existsSync(join(dirs.outDir, file))).toBe(true);
  });

  it("reports a file sharp cannot read as failed", async () => {
    const dirs = setup();
    mkdirSync(dirs.sourceDir, { recursive: true });
    writeFileSync(join(dirs.sourceDir, "Broken.png"), "not a png");
    const report = await generateBundledThumbnails(dirs);
    expect(report.failed).toEqual(["Broken"]);
    expect(report.rendered).toEqual([]);
  });
});

describe("manifestSource", () => {
  it("is one sorted entry per line, parseable back as JSON", () => {
    const source = manifestSource({
      b: { base: "/t/b.1", widths: [160], width: 10, height: 5 },
      a: { base: "/t/a.1", widths: [160], width: 10, height: 5 },
    });
    const body = source.slice(source.indexOf("{", source.indexOf("BUNDLED_TOOL_THUMBNAILS")), source.lastIndexOf("}") + 1);
    expect(Object.keys(JSON.parse(body))).toEqual(["a", "b"]);
  });
});
