// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import labFile from "../../../lab/lab.config";
import { SHIPPED_PLAN } from "../map/plan";
import { inventoryReport, labSummary, missingPublicFiles } from "./check";

describe("lab:check's checks (lab config spec §5.2)", () => {
  it("finds every public/ file the shipped config names", () => {
    expect(missingPublicFiles(labFile, (path) => existsSync(join(process.cwd(), "public", path)))).toEqual([]);
  });

  it("names each missing file, and an SVG logo's missing PNG twin", () => {
    const present = new Set(["/lab/logo.svg", "/lab/wordmark.svg"]);
    expect(missingPublicFiles(labFile, (path) => present.has(path))).toEqual([
      "photos.0.src: public/lab/makerlab-printers.webp does not exist",
      "photos.1.src: public/lab/makerlab-floor.webp does not exist",
      "brand.logo: public/lab/logo.png does not exist (an SVG logo needs a PNG twin for QR sheets and link previews)",
    ]);
  });

  it("says what the site will say", () => {
    expect(labSummary(labFile)).toContain("Sign-in:     anyone @cornell.edu");
  });

  it("--inventory lists unmatched locations with the line that would place them, and unused zones", () => {
    const report = inventoryReport(SHIPPED_PLAN, [
      { room: "Studio 101", zone: "3D Printing Hub", mapTag: null, tools: 4 },
      { room: "Studio 101C", zone: "Laser Machine Room", mapTag: "4A", tools: 1 },
      { room: "Wood Shop", zone: "Bench 2", mapTag: null, tools: 3 },
    ]);
    expect(report).toEqual([
      "1 location(s) land nowhere on the plan. Add a line to the zone they belong to:",
      '  "Wood Shop / Bench 2"  (3 tool(s))  →  "matches": ["Wood Shop / Bench 2"]',
      "Zones no location uses: Z1 Studio 101 / Common Purpose Space; Z3 Studio 101A / Machining Shop; Z5 Studio 101D / Electronics Lab",
    ]);
  });
});
