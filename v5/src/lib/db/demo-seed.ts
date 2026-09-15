import {
  attachments,
  categories,
  locations,
  projectTools,
  projects,
  resources,
  tools,
  units,
} from "./schema/index.ts";
import type { Db } from "./types.ts";

/**
 * Sample data for a database with no `DATABASE_URL` (spec §3.10): the two
 * tools the mock catalogue has always shown, now as real rows so the same
 * query modules serve tests, E2E and a fresh clone, plus one published
 * sample project built with them so the gallery, the project page and a
 * tool's "built with this" section all have something to show. Idempotent —
 * a database that already has tools is left alone.
 *
 * Images are `attachments` rows whose `public_url` points at files under
 * `public/` (allowed by `images.localPatterns` in next.config.ts), the same
 * shape an imported Blob attachment has, so no code path is demo-specific.
 *
 * Form 4 carries a `notionPageId`, exercising the legacy `/tools/<notion-id>`
 * redirect (spec Goal 2) end to end without a real database. Its unit carries
 * one too: the writes still on Notion until Phase 3 relate rows by page id, so
 * an imported row and a purely local one (the Trotec, which has neither) are
 * both worth having in the seed.
 */
export const DEMO_FORM_4_NOTION_PAGE_ID = "1f2e3d4c-5b6a-4789-8abc-def012345678";

/** The Notion page behind the Form 4's one unit — the `unit` relation target. */
export const DEMO_FORM_4_UNIT_NOTION_PAGE_ID = "2a3b4c5d-6e7f-4890-9abc-def012345678";

/** The sample project's slug, for tests and E2E. */
export const DEMO_PROJECT_SLUG = "laser-cut-plywood-lamp";

export async function seedDemo(db: Db): Promise<void> {
  const existing = await db.select({ id: tools.id }).from(tools).limit(1);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    const [resin, co2] = await tx
      .insert(categories)
      .values([
        { name: "Resin", group: "3D Printing" },
        { name: "CO2", group: "Laser" },
      ])
      .returning({ id: categories.id });

    const [resinBench, laserBay] = await tx
      .insert(locations)
      .values([
        { room: "MakerLab", zone: "Resin Bench", mapTag: "ML-RESIN-01" },
        { room: "Laser Room", zone: "Laser Bay", mapTag: "ML-LSR-400" },
      ])
      .returning({ id: locations.id });

    const [form4, trotec] = await tx
      .insert(tools)
      .values([
        {
          slug: "form-4",
          name: "Form 4",
          description:
            "A production-grade resin printer used for detailed parts that need smooth surfaces, tight tolerances, or engineering material properties. Requires resin handling discipline, post-processing, and ventilation awareness.",
          categoryId: resin.id,
          locationId: resinBench.id,
          materials: ["Standard resin", "Tough resin", "Flexible resin", "Dental resin"],
          ppeRequired: ["Nitrile gloves", "Safety glasses", "Lab coat"],
          tags: ["Resin", "SLA", "Prototyping"],
          trainingRequired: true,
          useRestrictions: "Resin handling training required before first print.",
          emergencyStop: "Lift the lid to immediately halt the print and pause the build.",
          notes: "Always wear nitrile gloves when handling uncured resin. Ventilation must be running.",
          published: true,
          notionPageId: DEMO_FORM_4_NOTION_PAGE_ID,
        },
        {
          slug: "trotec-speedy-400",
          name: "Trotec Speedy 400",
          description:
            "Large format laser platform for cutting and engraving approved flat stock. Users must verify material compatibility, ventilation, fire watch, and job setup before operation.",
          categoryId: co2.id,
          locationId: laserBay.id,
          materials: ["Acrylic", "Paper", "Cardboard", "Plywood"],
          ppeRequired: ["Safety glasses", "Fire watch", "Approved materials only"],
          tags: ["Laser", "CO2", "Cutting", "Engraving", "Authorized"],
          trainingRequired: true,
          useRestrictions: "Authorized users only. Material list must be confirmed with staff.",
          emergencyStop: "Press the red E-stop on the right side of the gantry to cut power instantly.",
          notes: "Run exhaust for 60 seconds after cuts before opening the lid.",
          published: true,
        },
      ])
      .returning({ id: tools.id });

    await tx.insert(units).values([
      {
        toolId: form4.id,
        unitLabel: "Form 4 // A",
        serialNumber: "ML-F4-001",
        status: "in_use",
        condition: "excellent",
        dateAcquired: "2024-08-12",
        notionPageId: DEMO_FORM_4_UNIT_NOTION_PAGE_ID,
      },
      {
        toolId: trotec.id,
        unitLabel: "Trotec Speedy 400",
        serialNumber: "ML-LSR-400",
        status: "available",
        condition: "good",
        dateAcquired: "2022-04-03",
      },
    ]);

    await tx.insert(resources).values([
      { toolId: form4.id, title: "Form 4 SOP", type: "SOP", url: "#" },
      { toolId: form4.id, title: "Resin handling safety", type: "Safety", url: "#" },
      { toolId: trotec.id, title: "Trotec Speedy 400 SOP", type: "SOP", url: "#" },
      { toolId: trotec.id, title: "Approved material list", type: "Safety", url: "#" },
    ]);

    // Tool photos. The Form 4's bundled image matches its name, so the
    // catalogue's fallback finds it; the Trotec's does not ("…, 80w.png"), so
    // it gets an explicit attachment like an imported tool would.
    await tx.insert(attachments).values({
      ownerType: "tool",
      ownerId: trotec.id,
      position: 0,
      blobPathname: "demo/tools/trotec-speedy-400.png",
      access: "public",
      publicUrl: "/tool-images/Trotec Speedy 400, 80w.png",
      contentType: "image/png",
      originalFilename: "Trotec Speedy 400, 80w.png",
    });

    const [lamp] = await tx
      .insert(projects)
      .values({
        slug: DEMO_PROJECT_SLUG,
        title: "Laser-cut plywood lamp",
        body: [
          "A bedside lamp cut from a single sheet of 3 mm birch plywood on the Trotec, with a resin diffuser printed on the Form 4.",
          "",
          "## How it went",
          "",
          "The slats are a living hinge pattern, so the shade bends round a hexagonal base without any steam. Two passes at 60 % power cut cleanly; the first attempt at 80 % scorched the edges.",
          "",
          "The diffuser is a 1 mm resin shell that slots over an LED strip. Sanding the cut edges before glue-up made the joints close up properly.",
          "",
          "Read more about the process on [Wikipedia](https://en.wikipedia.org/wiki/Laser_cutting).",
        ].join("\n"),
        link: "https://en.wikipedia.org/wiki/Laser_cutting",
        materials: ["3 mm birch plywood", "Wood glue", "LED strip", "Standard resin", "Sandpaper"],
        authorName: "MakerLab demo",
        published: true,
        publishedAt: new Date("2026-03-02T15:00:00.000Z"),
        createdAt: new Date("2026-03-01T15:00:00.000Z"),
      })
      .returning({ id: projects.id });

    await tx.insert(projectTools).values([
      { projectId: lamp.id, toolId: trotec.id },
      { projectId: lamp.id, toolId: form4.id },
    ]);

    await tx.insert(attachments).values([
      {
        ownerType: "project",
        ownerId: lamp.id,
        position: 0,
        blobPathname: "demo/projects/laser-cut-lamp-lit.png",
        access: "public",
        publicUrl: "/sample-projects/laser-cut-lamp-lit.png",
        contentType: "image/png",
        originalFilename: "laser-cut-lamp-lit.png",
      },
      {
        ownerType: "project",
        ownerId: lamp.id,
        position: 1,
        blobPathname: "demo/projects/laser-cut-lamp-parts.png",
        access: "public",
        publicUrl: "/sample-projects/laser-cut-lamp-parts.png",
        contentType: "image/png",
        originalFilename: "laser-cut-lamp-parts.png",
      },
    ]);
  });
}
