// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { auditEvents } from "../db/schema/index";
import { expectViolation } from "../../../test/db";
import { insertUserRow } from "../../../test/utils/session";
import type { Db } from "../db/types";
import * as audit from "./audit";
import { listAuditEvents, recordAuditEvent } from "./audit";

/**
 * The audit trail against a real (in-process) Postgres. No env, no network.
 */

let db: Db;
let actorId: string;

beforeAll(async () => {
  db = await createPgliteDb();
  const actor = await insertUserRow(db, {
    id: "audit-actor",
    email: "director@cornell.edu",
    role: "super_admin",
  });
  actorId = actor.id;
});

beforeEach(async () => {
  await db.delete(auditEvents);
});

describe("recordAuditEvent", () => {
  it("round-trips an event, its jsonb detail, and a server-set timestamp", async () => {
    const before = Date.now();
    const { id } = await recordAuditEvent(
      {
        actorUserId: actorId,
        action: "role.changed",
        subjectType: "user",
        subjectId: "someone-else",
        detail: { from: "user", to: "admin" },
      },
      { db }
    );

    const [event] = await listAuditEvents({ db });
    expect(event.id).toBe(id);
    expect(event).toMatchObject({
      actorUserId: actorId,
      action: "role.changed",
      subjectType: "user",
      subjectId: "someone-else",
      detail: { from: "user", to: "admin" },
    });
    // `at` is the column default, not the caller's clock — a skewed instance
    // must not be able to reorder the trail.
    expect(event.at.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("stores no detail as null rather than an empty object", async () => {
    await recordAuditEvent(
      {
        actorUserId: actorId,
        action: "user.banned",
        subjectType: "user",
        subjectId: "someone-else",
      },
      { db }
    );

    const [event] = await listAuditEvents({ db });
    expect(event.detail).toBeNull();
  });

  it("accepts a null actor — an action nobody took on somebody's behalf", async () => {
    await recordAuditEvent(
      {
        actorUserId: null,
        action: "tool.archived",
        subjectType: "tool",
        subjectId: "some-tool",
      },
      { db }
    );

    const [event] = await listAuditEvents({ db });
    expect(event.actorUserId).toBeNull();
  });

  it("refuses an actor that names no user row (the Phase 4 foreign key)", async () => {
    await expectViolation(
      recordAuditEvent(
        {
          actorUserId: "nobody-by-that-id",
          action: "role.changed",
          subjectType: "user",
          subjectId: "someone-else",
        },
        { db }
      ),
      /actor_user_id|foreign key/i
    );
  });
});

describe("listAuditEvents", () => {
  beforeEach(async () => {
    for (const subjectId of ["alpha", "beta", "alpha"]) {
      await recordAuditEvent(
        {
          actorUserId: actorId,
          action: "role.changed",
          subjectType: "user",
          subjectId,
        },
        { db }
      );
    }
  });

  it("returns every event when given no subject", async () => {
    expect(await listAuditEvents({ db })).toHaveLength(3);
  });

  it("narrows to one subject when given both halves of the key", async () => {
    const events = await listAuditEvents({
      db,
      subjectType: "user",
      subjectId: "alpha",
    });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.subjectId === "alpha")).toBe(true);
  });

  it("ignores half a subject key rather than reading the whole table by it", async () => {
    // Half a composite key is not a filter, so the honest behaviour is to
    // return everything rather than pretend to have narrowed.
    expect(await listAuditEvents({ db, subjectType: "user" })).toHaveLength(3);
  });

  it("caps at the requested limit", async () => {
    expect(await listAuditEvents({ db, limit: 2 })).toHaveLength(2);
  });
});

describe("the module's shape", () => {
  it("exports no way to change or remove an event", () => {
    // Append-only is the guarantee (spec §4.11). The cheapest way to make it
    // reviewable is for the edit to not exist, and this is the test that keeps
    // it that way when somebody adds a convenience later.
    const mutators = Object.keys(audit).filter((name) =>
      /^(update|delete|remove|clear|edit)/i.test(name)
    );
    expect(mutators).toEqual([]);
  });
});
