/**
 * What the stubbed model "identifies" and "researches" in the intake E2E
 * (gateway spec §10, E2E scenario 5 — formerly data platform spec §10).
 *
 * Shared by the spec and by `gateway-stub.ts`, so the names the test types
 * and clicks are the names the stub answers with. No imports: the stub runs
 * under plain Node.
 *
 * None of these is anywhere near a demo-seed tool or pending item by the
 * duplicate check's measure, so the table starts with nothing to resolve.
 */

/**
 * The first of the four ports the E2E run uses: the main app on it, the
 * Gateway stub on +1, the Notion stub on +2, the intake app on +3. 3100 unless
 * `E2E_PORT_BASE` says otherwise — so a second checkout (or an agent's
 * worktree) can run the suite beside one already running.
 */
export const E2E_PORT_BASE = Number(process.env.E2E_PORT_BASE) || 3100;

/** The port the stub listens on. The app reaches it through `AI_GATEWAY_BASE_URL`. */
export const GATEWAY_STUB_PORT = E2E_PORT_BASE + 1;

export const GATEWAY_STUB_ORIGIN = `http://localhost:${GATEWAY_STUB_PORT}`;

/**
 * The intake scenario's own app server: the same production build as every
 * other spec's (port 3100; 3101 is the Gateway stub, 3102 the Notion stub),
 * started a second time with a local Blob folder so research can store the
 * cleaned product image and approval can publish it (playwright.config.ts).
 * Its demo database is its own, too.
 */
export const INTAKE_APP_PORT = E2E_PORT_BASE + 3;

export const INTAKE_APP_ORIGIN = `http://localhost:${INTAKE_APP_PORT}`;

export interface IntakeFixtureItem {
  /** What `identify_tools` records — the first one carries a typo the test corrects. */
  identifiedAs: string;
  /** The name research settles on, and the one the gallery shows after approval. */
  name: string;
  brand: string;
  categoryHint: string;
  slug: string;
}

export const INTAKE_ITEMS = {
  /** Edited on the card, researched, approved. */
  domino: {
    identifiedAs: "Festool Domino DF500",
    name: "Festool Domino DF 500",
    brand: "Festool",
    categoryHint: "Woodworking",
    slug: "festool-domino-df-500",
  },
  /** Researched and left for review. */
  sawstop: {
    identifiedAs: "SawStop PCS 175",
    name: "SawStop PCS 175",
    brand: "SawStop",
    categoryHint: "Woodworking",
    slug: "sawstop-pcs-175",
  },
  /** Deselected on the card; waits on `/admin/intake`. */
  shapeoko: {
    identifiedAs: "Shapeoko 5 Pro",
    name: "Shapeoko 5 Pro",
    brand: "Carbide 3D",
    categoryHint: "CNC",
    slug: "shapeoko-5-pro",
  },
} satisfies Record<string, IntakeFixtureItem>;

/** The message that makes the stubbed chat model call `identify_tools`. */
export const IDENTIFY_PROMPT =
  "A Festool Domino, the SawStop table saw and the new Shapeoko are on the bench.";

/** The stubbed chat model's reply to the header's Add seed. */
export const ASK_FOR_ITEMS_REPLY = "What are they? Send photos, or tell me the makes and models.";

/**
 * Many items at once (data platform spec amendment "Many items at once"): the
 * second scenario's message, sent with two photos. The stub answers with one
 * `identify_tools` call naming four objects across them — one of them in both
 * photos, one a pair, one it cannot name.
 */
export const MULTI_PROMPT = "Everything on the craft bench and the shelf, please.";

export const MULTI_ITEMS = {
  /** In photo 1 only. */
  drillPress: "RYOBI DP103L Drill Press",
  /** In both photos: one item with two photos (the second a copy). */
  cutter: "Cricut Maker 3",
  /** In photo 1, a pair: one item, quantity 2. */
  battery: "RYOBI ONE+ 18V 3.0 Ah Battery P103",
  /** In photo 2, unnamed: starts unticked. */
  unsure: "Soldering station, model not visible",
} as const;

/** The two photos the scenario sends — the eval's own fixtures (`evals/fixtures/photos`). */
export const MULTI_PHOTOS = ["bench-three-tools.jpg", "shelf-b.jpg"] as const;

/** The stubbed chat model's line after the table renders. */
export const AFTER_TABLE_REPLY = "Three items are on the table. Untick anything you don't want researched yet.";
