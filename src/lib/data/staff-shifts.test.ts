// @vitest-environment node
import { insertUserRow } from "../../../test/utils/session";
import { createPgliteDb } from "../db/pglite";
import { staffShifts } from "../db/schema/index";
import type { Db } from "../db/types";
import { endShift, getOwnShiftEnd, listCurrentShifts, startShift } from "./staff-shifts";

/**
 * `staff_shifts` against a real (in-process) Postgres (on-shift spec
 * 2026-10-07 §10): one row per person, replaced by a new shift, deleted by
 * ending it, and never read back once its end has passed.
 */

let db: Db;
const NOW = new Date("2026-10-07T18:00:00Z");
const IN_TWO_HOURS = new Date("2026-10-07T20:00:00Z");
const AN_HOUR_AGO = new Date("2026-10-07T17:00:00Z");

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(staffShifts);
});

it("starts a shift, and a second start replaces it rather than adding a row", async () => {
  const alex = await insertUserRow(db, { name: "Alex Morgan", role: "admin" });
  await startShift(alex.id, AN_HOUR_AGO, { db });
  await startShift(alex.id, IN_TWO_HOURS, { db });

  const rows = await db.select().from(staffShifts);
  expect(rows).toHaveLength(1);
  expect(new Date(rows[0].endsAt).toISOString()).toBe(IN_TWO_HOURS.toISOString());
  expect(await getOwnShiftEnd(alex.id, { db, now: NOW })).toBe(IN_TWO_HOURS.toISOString());
});

it("ends a shift, and says whether there was one to end", async () => {
  const alex = await insertUserRow(db, { name: "Alex Morgan", role: "admin" });
  await startShift(alex.id, IN_TWO_HOURS, { db });
  expect(await endShift(alex.id, { db })).toEqual({ ended: true });
  expect(await endShift(alex.id, { db })).toEqual({ ended: false });
  expect(await getOwnShiftEnd(alex.id, { db, now: NOW })).toBeNull();
});

it("reads a shift whose end has passed as no shift, for the person and for everyone", async () => {
  const alex = await insertUserRow(db, { name: "Alex Morgan", role: "admin" });
  await startShift(alex.id, AN_HOUR_AGO, { db });
  expect(await getOwnShiftEnd(alex.id, { db, now: NOW })).toBeNull();
  expect(await listCurrentShifts({ db, now: NOW })).toEqual([]);
});

it("lists current shifts with what deciding who may appear needs", async () => {
  const alex = await insertUserRow(db, { name: "Alex Morgan", role: "admin", email: "alex.m@cornell.edu" });
  const sam = await insertUserRow(db, { name: "Sam Lee", role: "admin" });
  await startShift(alex.id, IN_TWO_HOURS, { db });
  await startShift(sam.id, AN_HOUR_AGO, { db });

  expect(await listCurrentShifts({ db, now: NOW })).toEqual([
    { userId: alex.id, name: "Alex Morgan", email: "alex.m@cornell.edu", role: "admin", banned: false, endsAt: IN_TWO_HOURS.toISOString() },
  ]);
});
