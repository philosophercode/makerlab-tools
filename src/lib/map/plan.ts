// The plan is shown to signed-in people only (map access, PR #98): keep it out of client bundles.
import "server-only";
import planFile from "../../../lab/floor-plan.json";
import { lab } from "../lab/config";
import type { FloorPlan } from "./types";

/**
 * The lab's floor plan (lab config spec 2026-10-25 §4, phase 2): the drawing
 * in `lab/floor-plan.json`, traced by hand or by a vision model from the lab's
 * own plan (`docs/map.md`). `npm run lab:check` and the tests validate it
 * against `schema.ts`; the app reads it as written.
 *
 * Imported only here, behind `server-only`, so the drawing never reaches a
 * client bundle: the pages that show it render it on the server for a
 * signed-in person and pass it down.
 */
const { $schema: _schema, ...shipped } = planFile;
// JSON imports type a point as number[], not [x, y]; the schema test holds the shape.
export const SHIPPED_PLAN: FloorPlan = shipped as unknown as FloorPlan;

/** The lab's plan, or null when the lab config turns the map off (`map: false`). */
export const LAB_PLAN: FloorPlan | null = lab.map ? SHIPPED_PLAN : null;

/** Every plan the app knows, first is the default. One floor today (floor map spec §4.4). */
export const FLOOR_PLANS: readonly FloorPlan[] = LAB_PLAN ? [LAB_PLAN] : [];
