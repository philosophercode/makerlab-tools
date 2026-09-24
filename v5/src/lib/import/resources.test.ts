import { approvalUnits, importApprovalResources, importLinkResource, labDocResource } from "./resources";

describe("quantity and serials become units of one tool (bulk intake spec §2, §10)", () => {
  it("'Quantity 5' is five units, never five tools", () => {
    const units = approvalUnits("Form 2", 5, [], null);
    expect(units).toHaveLength(5);
    expect(units.map((unit) => unit.unitLabel)).toEqual(["Form 2 #1", "Form 2 #2", "Form 2 #3", "Form 2 #4", "Form 2 #5"]);
  });

  it("puts each serial on its own unit, the reviewer's first", () => {
    expect(approvalUnits("Drill", 1, ["D1", "D2", "D3"], "D1-confirmed")).toEqual([
      { unitLabel: "Drill #1", serialNumber: "D1-confirmed" },
      { unitLabel: "Drill #2", serialNumber: "D2" },
      { unitLabel: "Drill #3", serialNumber: "D3" },
    ]);
  });

  it("numbers on from an existing tool's units", () => {
    expect(approvalUnits("Laser", 2, [], undefined, 4).map((unit) => unit.unitLabel)).toEqual(["Laser #4", "Laser #5"]);
  });

  it("is always at least one", () => {
    expect(approvalUnits("Saw", 0, [], null)).toHaveLength(1);
  });
});

describe("the import's links at approval (§3.4)", () => {
  it("makes a lab document an Other resource marked lab_document", () => {
    expect(labDocResource({ title: "SOP", url: "https://docs.google.com/d/1" })).toEqual({
      title: "SOP",
      url: "https://docs.google.com/d/1",
      type: "Other",
      origin: "lab_document",
    });
  });

  it("types a PDF link as a Manual, anything else as Other, titled by host", () => {
    expect(importLinkResource({ url: "https://www.formlabs.com/docs/form2.pdf" })).toEqual({
      title: "formlabs.com",
      url: "https://www.formlabs.com/docs/form2.pdf",
      type: "Manual",
    });
    expect(importLinkResource({ url: "https://formlabs.com/form-2" }).type).toBe("Other");
  });

  it("keeps the ticked links, always the lab documents, and nothing research already has", () => {
    const extra = importApprovalResources(
      {
        links: [{ url: "https://a.example/manual.pdf" }, { url: "https://b.example/page" }, { url: "https://c.example/x" }],
        labDocs: [{ title: "SOP", url: "https://docs.google.com/d/1" }],
        keepLinkUrls: ["https://a.example/manual.pdf", "https://c.example/x"],
      },
      ["https://c.example/x"]
    );
    expect(extra.map((resource) => resource.url)).toEqual(["https://a.example/manual.pdf", "https://docs.google.com/d/1"]);
  });
});
