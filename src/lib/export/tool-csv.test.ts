import { CSV_BOM } from "./csv";
import {
  TOOL_EXPORT_HEADERS,
  portableUrl,
  toolExportRow,
  toolsCsv,
  toolsCsvFilename,
  type ToolExportRecord,
} from "./tool-csv";

const ORIGIN = "https://makerlab.example";

/** A fully populated tool, as the read hands it over. */
function fixtureTool(overrides: Partial<ToolExportRecord> = {}): ToolExportRecord {
  return {
    id: "6f1c1c7e-1d2a-4c55-9d1e-0a1b2c3d4e5f",
    slug: "form-4",
    name: "Form 4",
    officialName: "Formlabs Form 4 MSLA 3D Printer",
    status: "published",
    itemKind: "equipment",
    accessoryOf: null,
    category: "3D Printing",
    subcategory: "Resin Printers",
    description: "A resin printer for detailed parts, 50 µm layers.",
    room: "MakerLAB",
    zone: "Resin Room",
    mapTag: "ML-RESIN-01",
    trainingRequired: true,
    ppe: ["Nitrile gloves", "Safety glasses"],
    useRestrictions: "Trained users only",
    emergencyStop: "Lid opens to stop",
    materials: ["Resin", "Clear resin"],
    tags: ["sla", "printer"],
    notes: "Wash in IPA after printing",
    unitLabels: ["Form 4 #1", "Form 4 #2"],
    photoUrls: ["https://blob.test/form-4.png", "/tool-images/Form%204.png"],
    resourceUrls: ["https://formlabs.com/manual.pdf"],
    lastReviewedAt: new Date("2026-09-20T12:00:00.000Z"),
    createdAt: new Date("2026-09-14T08:30:00.000Z"),
    updatedAt: new Date("2026-09-28T17:45:10.000Z"),
    ...overrides,
  };
}

/** The row as a header → value object, so a test names the column it checks. */
function byHeader(record: ToolExportRecord): Record<string, unknown> {
  const cells = toolExportRow(record, ORIGIN);
  return Object.fromEntries(TOOL_EXPORT_HEADERS.map((header, i) => [header, cells[i]]));
}

describe("the tools CSV's columns", () => {
  it("has human-readable headers in a fixed order", () => {
    expect(TOOL_EXPORT_HEADERS).toEqual([
      "ID",
      "Slug",
      "Name",
      "Official name",
      "Status",
      "Item kind",
      "Accessory of",
      "Category",
      "Subcategory",
      "Description",
      "Room",
      "Zone",
      "Map tag",
      "Training required",
      "PPE required",
      "Use restrictions",
      "Emergency stop",
      "Materials",
      "Tags",
      "Notes",
      "Unit count",
      "Unit labels",
      "Photo URLs",
      "Resource URLs",
      "Tool page URL",
      "Last reviewed",
      "Created",
      "Updated",
    ]);
  });

  it("maps a fixture tool to one row", () => {
    expect(byHeader(fixtureTool())).toEqual({
      ID: "6f1c1c7e-1d2a-4c55-9d1e-0a1b2c3d4e5f",
      Slug: "form-4",
      Name: "Form 4",
      "Official name": "Formlabs Form 4 MSLA 3D Printer",
      Status: "published",
      "Item kind": "equipment",
      "Accessory of": null,
      Category: "3D Printing",
      Subcategory: "Resin Printers",
      Description: "A resin printer for detailed parts, 50 µm layers.",
      Room: "MakerLAB",
      Zone: "Resin Room",
      "Map tag": "ML-RESIN-01",
      "Training required": "Yes",
      "PPE required": "Nitrile gloves; Safety glasses",
      "Use restrictions": "Trained users only",
      "Emergency stop": "Lid opens to stop",
      Materials: "Resin; Clear resin",
      Tags: "sla; printer",
      Notes: "Wash in IPA after printing",
      "Unit count": 2,
      "Unit labels": "Form 4 #1; Form 4 #2",
      // The bundled photo's root-relative path is made absolute.
      "Photo URLs": "https://blob.test/form-4.png; https://makerlab.example/tool-images/Form%204.png",
      "Resource URLs": "https://formlabs.com/manual.pdf",
      "Tool page URL": "https://makerlab.example/tools/form-4",
      "Last reviewed": "2026-09-20T12:00:00.000Z",
      Created: "2026-09-14T08:30:00.000Z",
      Updated: "2026-09-28T17:45:10.000Z",
    });
  });

  it("writes what is stored, never a display fallback", () => {
    const row = byHeader(
      fixtureTool({
        officialName: null,
        category: null,
        subcategory: null,
        description: null,
        room: null,
        zone: null,
        trainingRequired: false,
        ppe: [],
        unitLabels: [],
        photoUrls: [],
        resourceUrls: [],
        lastReviewedAt: null,
      })
    );
    expect(row.Category).toBeNull();
    expect(row.Description).toBeNull();
    expect(row["PPE required"]).toBe("");
    expect(row["Training required"]).toBe("No");
    expect(row["Unit count"]).toBe(0);
    expect(row["Photo URLs"]).toBe("");
    expect(row["Last reviewed"]).toBe("");
  });

  it("carries draft and archived as the Status", () => {
    expect(byHeader(fixtureTool({ status: "draft" })).Status).toBe("draft");
    expect(byHeader(fixtureTool({ status: "archived" })).Status).toBe("archived");
  });
});

describe("toolsCsv", () => {
  it("is one header record plus one record per tool, BOM first", () => {
    const csv = toolsCsv([fixtureTool(), fixtureTool({ id: "b", slug: "speedy-400", name: "Speedy 400" })], ORIGIN);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(TOOL_EXPORT_HEADERS.join(","));
    expect(lines).toHaveLength(4); // header, two tools, and the empty string after the last CRLF
    expect(lines[3]).toBe("");
  });

  it("quotes a description with a comma and a line break, and defuses one that starts a formula", () => {
    const csv = toolsCsv([fixtureTool({ description: "Cuts wood, acrylic\nand card", notes: "=HYPERLINK(\"x\")" })], ORIGIN);
    expect(csv).toContain('"Cuts wood, acrylic\nand card"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe("helpers", () => {
  it("names the file for the day", () => {
    expect(toolsCsvFilename(new Date("2026-09-29T23:00:00Z"))).toBe("makerlab-tools-2026-09-29.csv");
  });

  it("makes a root-relative URL absolute, encodes a space, and keeps an absolute one", () => {
    expect(portableUrl("/tool-images/a.png", "https://x.test/")).toBe("https://x.test/tool-images/a.png");
    expect(portableUrl("/tool-images/Speedy 400, 80w.png", "https://x.test")).toBe("https://x.test/tool-images/Speedy%20400,%2080w.png");
    expect(portableUrl("https://blob.test/a%20b.png", "https://x.test")).toBe("https://blob.test/a%20b.png");
  });

  it("drops a link that means nothing outside the app", () => {
    for (const url of ["#", "", "manual.pdf", "//cdn.test/a.png", "javascript:alert(1)", "data:text/html,x", "ftp://x.test/a"]) {
      expect([url, portableUrl(url, "https://x.test")]).toEqual([url, null]);
    }
  });

  it("leaves placeholder links out of the cell", () => {
    const cells = toolExportRow(fixtureTool({ resourceUrls: ["#", "https://formlabs.com/manual.pdf", "#"] }), ORIGIN);
    expect(cells[TOOL_EXPORT_HEADERS.indexOf("Resource URLs")]).toBe("https://formlabs.com/manual.pdf");
  });
});
