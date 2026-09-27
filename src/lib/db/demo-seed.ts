import {
  attachments,
  categories,
  feedback,
  locations,
  maintenanceLogs,
  pendingTools,
  projectTools,
  projects,
  resources,
  session,
  tools,
  units,
  user,
} from "./schema/index.ts";
import type { ResearchResult } from "../research/result.ts";
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
 * one too. No write reads those ids any more — Phase 3 moved the last three
 * onto Postgres — but an imported row and a purely local one (the Trotec, which
 * has neither) are both worth having in the seed, because the redirect has to
 * keep working for every QR label already stuck to a machine.
 */
export const DEMO_FORM_4_NOTION_PAGE_ID = "1f2e3d4c-5b6a-4789-8abc-def012345678";

/** The Notion page the Form 4's one unit was imported from. */
export const DEMO_FORM_4_UNIT_NOTION_PAGE_ID = "2a3b4c5d-6e7f-4890-9abc-def012345678";

/** The sample project's slug, for tests and E2E. */
export const DEMO_PROJECT_SLUG = "laser-cut-plywood-lamp";

/**
 * The submission waiting for a decision on `/admin/projects`, for tests and
 * E2E (spec §5.6).
 *
 * Unpublished, so it is invisible to the gallery, to `findPublishedProject`
 * and to every cached read — which is exactly the point. A moderation queue
 * with nothing in it demonstrates nothing, and Article 5's gate is only
 * visible when there is something standing at it.
 */
export const DEMO_WAITING_PROJECT_SLUG = "resin-dice-tower";

/**
 * One demo account per role, each with a session row whose token is a constant
 * (spec §10). Sessions are rows since Phase 4, so this is what lets the E2E
 * suite be somebody without Google: the browser presents a cookie carrying one
 * of these tokens, signed with the test-only `AUTH_SECRET` the Playwright
 * server boots with, and the server resolves the role from the `user` row.
 *
 * **Demo data only.** These rows exist exclusively in the PGlite substrate —
 * `seedDemo` runs from `createPgliteDb` and nowhere else, so a deployment with
 * `DATABASE_URL` set never sees them. The tokens are public constants in a
 * public repository, and they are worthless without the secret that signs
 * them; a deployment that set a real `AUTH_SECRET` also set `DATABASE_URL`,
 * and these rows are not in that database.
 */
export const DEMO_ACCOUNTS = {
  user: {
    id: "demo-user-casey",
    name: "Casey Rivera",
    email: "casey@cornell.edu",
    role: "user",
    sessionToken: "demo-session-user",
  },
  admin: {
    id: "demo-user-niti",
    name: "Niti Parikh",
    email: "niti@cornell.edu",
    role: "admin",
    sessionToken: "demo-session-admin",
  },
  superAdmin: {
    id: "demo-user-isaac",
    name: "Isaac Steinberg",
    email: "isaac@cornell.edu",
    role: "super_admin",
    sessionToken: "demo-session-super-admin",
  },
  /**
   * A second ordinary account, for the one E2E that *changes* a role
   * (spec §10 scenario 6).
   *
   * Its own row on purpose: the E2E suite runs its files in parallel against
   * one server, so promoting `user` would race `auth.spec.ts`'s assertion that
   * an ordinary account has no admin controls. Nothing but
   * `e2e/admin-users.spec.ts` touches this one.
   */
  promotable: {
    id: "demo-user-pat",
    name: "Pat Promotable",
    email: "pat@cornell.edu",
    role: "user",
    sessionToken: "demo-session-promotable",
  },
  /**
   * The account `e2e/admin-users.spec.ts` **removes** (auth spec amendment
   * 2026-09-25). Its own row for the reason `promotable` has one — and more so:
   * after that spec runs, it no longer exists on that server.
   */
  removable: {
    id: "demo-user-robin",
    name: "Robin Removable",
    email: "robin@cornell.edu",
    role: "user",
    sessionToken: "demo-session-removable",
  },
} as const;

/**
 * Three items waiting in `/admin/intake` (spec §5.4), all owned by the demo
 * admin, so the review page has something real to show and E2E something to
 * approve without a model or a workflow in the loop.
 *
 * - **Prusa MK4S** — researched, high confidence, one verified manual: the
 *   happy path, Approve enabled.
 * - **Unknown Vinyl Cutter** — researched, low confidence and nothing found:
 *   the §5.4 step 12 gate, Approve disabled until "I've checked this".
 * - **Glowforge Pro** — identified and never researched: the row a
 *   deselected item leaves behind.
 *
 * None shares a name with a demo tool, so none is born a duplicate. The ids
 * are constants because tests and E2E address these rows directly; they exist
 * only in the PGlite substrate, like everything else here.
 */
export const DEMO_PENDING = {
  researched: { id: "6a1f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a01", name: "Prusa MK4S" },
  lowConfidence: { id: "6a1f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a02", name: "Unknown Vinyl Cutter" },
  identified: { id: "6a1f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a03", name: "Glowforge Pro" },
} as const;

/** The batch the two researched items were identified in, and the later one. */
const DEMO_PENDING_BATCHES = {
  researched: "7b2e1d4f-1e8c-4d66-8a3b-2c9f8e4d5b01",
  identified: "7b2e1d4f-1e8c-4d66-8a3b-2c9f8e4d5b02",
} as const;

/**
 * The Prusa's research, as the workflow would have written it. `confidence`
 * is what `scoreConfidence(evidence)` computes — `demo-seed.test.ts` holds
 * the two to each other, since the seed cannot import the capability layer.
 */
export const DEMO_PRUSA_RESEARCH: ResearchResult = {
  canonicalName: "Original Prusa MK4S",
  description:
    "An open-frame FDM 3D printer with a 250 × 210 × 220 mm build volume, automatic bed levelling and an input-shaped motion system.",
  specs: [
    { label: "Build volume", value: "250 × 210 × 220 mm" },
    { label: "Nozzle", value: "0.4 mm (swappable)" },
  ],
  materials: ["PLA", "PETG", "ASA", "TPU"],
  ppeRequired: [],
  tags: ["3d-printing", "fdm"],
  trainingRequired: true,
  useRestrictions: null,
  category: { name: "FDM", group: "3D Printing", existingId: null },
  resources: [
    { title: "Original Prusa MK4S handbook", url: "https://help.prusa3d.com/product/mk4s", type: "Manual" },
  ],
  droppedLinks: [],
  sourceUrls: ["https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/"],
  evidence: {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: true,
    manualFound: true,
    specsFromSource: true,
    categoryOnly: false,
  },
  confidence: {
    level: "high",
    basis: [
      "The user gave the make and model",
      "Manufacturer or retailer page read",
      "Manual found",
      "Specs taken from a page that was read",
    ],
    unknowns: [],
  },
};

/** The vinyl cutter's research: nothing found, graded low, links invented by nobody. */
export const DEMO_VINYL_RESEARCH: ResearchResult = {
  canonicalName: "Vinyl cutter",
  description: "A desktop vinyl cutter. The make and model could not be identified from the photo.",
  specs: [],
  materials: ["Vinyl"],
  ppeRequired: [],
  tags: ["cutting"],
  trainingRequired: null,
  useRestrictions: null,
  category: { name: "Vinyl Cutting", group: null, existingId: null },
  resources: [],
  droppedLinks: [],
  sourceUrls: [],
  evidence: {
    userStatedModel: false,
    modelPlateRead: null,
    manufacturerPageFound: false,
    manualFound: false,
    specsFromSource: false,
    categoryOnly: true,
  },
  confidence: {
    level: "low",
    basis: [],
    unknowns: [
      "The model number could not be read — ask for a photo of the label",
      "Only the general type of equipment could be identified",
      "No manufacturer page or manual was found to check against",
    ],
  },
};

/** Far enough out that no demo session expires mid-suite. */
const DEMO_SESSION_EXPIRES_AT = new Date("2099-01-01T00:00:00.000Z");

export async function seedDemo(db: Db): Promise<void> {
  await seedDemoAccounts(db);

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
          // The official name beside the display name (tool display names spec);
          // the Trotec has none, so the demo shows both cases.
          officialName: "Formlabs Form 4 Resin 3D Printer",
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

    const [, trotecUnit] = await tx
      .insert(units)
      .values([
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
      ])
      // The Trotec's unit, so the demo maintenance ticket below can name a real
      // machine. Postgres returns the rows in the order they were given.
      .returning({ id: units.id });

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

    // ── One row for each of the three queues (spec §5.6) ──────────────
    //
    // Phase 5 gave the lab three admin surfaces whose whole content is rows
    // somebody filed, and a demo database with none of them shows three empty
    // states to anybody trying the app out. These are the smallest set that
    // makes each queue demonstrable — and deliberately *not* a draft tool,
    // because `e2e/admin-inventory.spec.ts` asserts that both seeded tools are
    // published and that `?state=draft` therefore empties the table.
    //
    // All three are attributed to the demo student account, which
    // `seedDemoAccounts` has already inserted: `created_by` has a foreign key
    // since migration 0003, so an author that is not a row would be refused.
    const student = DEMO_ACCOUNTS.user;

    await tx.insert(maintenanceLogs).values({
      title: "Laser bed out of focus",
      description:
        "Cuts on the left half of the bed are not going all the way through 3 mm ply. The focus gauge is in the drawer under the machine.",
      type: "issue_report",
      priority: "high",
      status: "open",
      unitId: trotecUnit.id,
      toolId: trotec.id,
      // Snapshots, so the ticket stays readable if the unit is retired (§4.8).
      toolName: "Trotec Speedy 400",
      unitLabel: "Trotec Speedy 400",
      reportedByName: student.name,
      reportedByEmail: student.email,
      reportedByUserId: student.id,
      dateReported: "2026-03-04",
      createdBy: student.id,
      updatedBy: student.id,
    });

    await tx.insert(feedback).values({
      toolId: form4.id,
      fieldFlagged: "materials",
      issueDescription:
        "The resin list is missing Rigid 10K, which the lab has had since January.",
      suggestedFix: "Add Rigid 10K to the materials.",
      reporterName: student.name,
      reporterEmail: student.email,
      reporterUserId: student.id,
      status: "new",
      createdBy: student.id,
      updatedBy: student.id,
    });

    const [diceTower] = await tx
      .insert(projects)
      .values({
        slug: DEMO_WAITING_PROJECT_SLUG,
        title: "Resin dice tower",
        body: [
          "A dice tower printed in three parts on the Form 4 and glued up, with a felt-lined tray so the dice stop rattling off the desk.",
          "",
          "The baffles are angled at 40 degrees, which was the third try — at 30 the dice stall on the top one.",
        ].join("\n"),
        materials: ["Standard resin", "Felt", "Cyanoacrylate"],
        authorName: student.name,
        authorUserId: student.id,
        // Article 5: a submission arrives unpublished and waits for a person.
        published: false,
        createdAt: new Date("2026-03-05T18:00:00.000Z"),
        createdBy: student.id,
        updatedBy: student.id,
      })
      .returning({ id: projects.id });

    await tx.insert(projectTools).values({ projectId: diceTower.id, toolId: form4.id });

    // Intake (§5.4): two researched items waiting for a decision, one never
    // sent to research. Owned by the demo admin — `created_by` is required and
    // references `user.id`, which `seedDemoAccounts` has already inserted.
    const admin = DEMO_ACCOUNTS.admin;
    const researchedAt = new Date("2026-03-06T15:00:00.000Z");
    await tx.insert(pendingTools).values([
      {
        id: DEMO_PENDING.researched.id,
        batchId: DEMO_PENDING_BATCHES.researched,
        status: "researched",
        name: DEMO_PENDING.researched.name,
        brand: "Prusa Research",
        categoryHint: "3D Printing",
        research: DEMO_PRUSA_RESEARCH,
        researchRequestedBy: admin.id,
        researchRequestedAt: researchedAt,
        createdBy: admin.id,
        createdAt: new Date("2026-03-06T14:55:00.000Z"),
      },
      {
        id: DEMO_PENDING.lowConfidence.id,
        batchId: DEMO_PENDING_BATCHES.researched,
        status: "researched",
        name: DEMO_PENDING.lowConfidence.name,
        categoryHint: "Cutting",
        research: DEMO_VINYL_RESEARCH,
        researchRequestedBy: admin.id,
        researchRequestedAt: researchedAt,
        createdBy: admin.id,
        createdAt: new Date("2026-03-06T14:55:00.000Z"),
      },
      {
        id: DEMO_PENDING.identified.id,
        batchId: DEMO_PENDING_BATCHES.identified,
        status: "identified",
        name: DEMO_PENDING.identified.name,
        brand: "Glowforge",
        categoryHint: "Laser",
        createdBy: admin.id,
        // Left at now(), unlike the others: the daily cron discards anything
        // identified for 14 days, and a demo row that expired would take the
        // "waiting on the intake page" case with it.
      },
    ]);
  });
}

/**
 * The three demo accounts and their sessions. Separately guarded from the
 * catalogue above so a database seeded before Phase 4 picks them up, and
 * idempotent for the same reason the rest of the seed is.
 */
async function seedDemoAccounts(db: Db): Promise<void> {
  const existing = await db.select({ id: user.id }).from(user).limit(1);
  if (existing.length > 0) return;

  const accounts = Object.values(DEMO_ACCOUNTS);

  await db.insert(user).values(
    accounts.map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      emailVerified: true,
      role: account.role,
    }))
  );

  await db.insert(session).values(
    accounts.map((account) => ({
      id: `${account.id}-session`,
      token: account.sessionToken,
      userId: account.id,
      expiresAt: DEMO_SESSION_EXPIRES_AT,
    }))
  );
}
