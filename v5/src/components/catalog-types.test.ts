import { toGalleryTool } from "./catalog-types";
import { mockCatalog } from "../../test/fixtures/catalog";

describe("toGalleryTool", () => {
  it("keeps what the gallery reads and drops the tool page's own fields", () => {
    const tool = { ...mockCatalog[0], notes: "Long internal notes", starterQuestions: ["How do I start?"] };
    const gallery = toGalleryTool(tool);

    expect(gallery).toMatchObject({
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      category: tool.category,
      status: tool.status,
      description: tool.description,
      imageSrc: tool.imageSrc,
      materials: tool.materials,
    });
    expect(gallery.units).toEqual(tool.units.map((unit) => ({ status: unit.status })));
    for (const dropped of ["links", "notes", "emergencyStop", "useRestrictions", "starterQuestions", "shortDescription", "trainingLabel", "mapId"]) {
      expect(gallery).not.toHaveProperty(dropped);
    }
  });
});
