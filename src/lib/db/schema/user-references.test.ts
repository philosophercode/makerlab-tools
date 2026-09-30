// @vitest-environment node
import { eq } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { createPgliteDb } from "../pglite";
import { user } from "./auth";
import { maintenanceLogs } from "./maintenance";
import { projects } from "./projects";
import { tools } from "./tools";
import type { Db } from "../types";

/**
 * Migration `0004` against a real (in-process) Postgres — the three `user.id`
 * foreign keys Phase 1 deferred and Phase 5 finally needs (spec §4.4, §4.8,
 * §4.10).
 *
 * These columns record *people*: who marked a tool reviewed, who a ticket is
 * assigned to, who decided a project belongs in the gallery. Until this
 * migration they were bare `text`, so an id naming no row went in without
 * complaint and came back out as a name nobody could resolve — and Phase 5 is
 * the first code that writes any of them.
 *
 * Each half is a thing that can only fail at runtime, so each is asserted here
 * rather than read off the schema file: the key **refuses** an id that names
 * nobody, and it **sets null rather than deleting** when the person goes. The
 * second half is the one worth a test of its own — `cascade` here would mean
 * removing a departing employee's account deleted the lab's tickets.
 */
describe("the user foreign keys on the actor columns", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  async function insertUser(): Promise<string> {
    const id = `u-${Math.random().toString(36).slice(2)}`;
    await db.insert(user).values({ id, name: "Test Person", email: `${id}@cornell.edu` });
    return id;
  }

  it("refuses a review mark whose reviewer names no user, and accepts null", async () => {
    await expectViolation(
      db.insert(tools).values({
        slug: "ghost-reviewer",
        name: "Ghost Reviewer",
        lastReviewedAt: new Date(),
        lastReviewedBy: "no-such-user",
      }),
      /tools_last_reviewed_by_user_id_fk/
    );

    // Null is the normal case: nothing imported has ever been reviewed.
    await db.insert(tools).values({ slug: "never-reviewed", name: "Never Reviewed" });
    const [row] = await db.select().from(tools).where(eq(tools.slug, "never-reviewed"));
    expect(row.lastReviewedBy).toBeNull();
  });

  it("keeps the review when the reviewer's account is deleted", async () => {
    const userId = await insertUser();
    const reviewedAt = new Date();
    await db.insert(tools).values({
      slug: "reviewed-by-a-leaver",
      name: "Reviewed By A Leaver",
      lastReviewedAt: reviewedAt,
      lastReviewedBy: userId,
    });

    await db.delete(user).where(eq(user.id, userId));

    const [row] = await db.select().from(tools).where(eq(tools.slug, "reviewed-by-a-leaver"));
    expect(row).toBeDefined();
    expect(row.lastReviewedBy).toBeNull();
    // The date survives the person, which is why both columns exist: "reviewed
    // in March, by somebody who has since left" is still worth more than
    // nothing, and the audit trail holds the name.
    expect(row.lastReviewedAt).not.toBeNull();
  });

  it("refuses a ticket assigned to no user, and unassigns rather than deleting", async () => {
    await expectViolation(
      db.insert(maintenanceLogs).values({
        title: "Assigned to nobody in particular",
        assignedToUserId: "no-such-user",
      }),
      /maintenance_logs_assigned_to_user_id_user_id_fk/
    );

    const userId = await insertUser();
    const [ticket] = await db
      .insert(maintenanceLogs)
      .values({
        title: "Laser bed out of focus",
        assignedToUserId: userId,
        // The snapshot beside the id, for exactly the case below.
        assignedToName: "Test Person",
      })
      .returning({ id: maintenanceLogs.id });

    await db.delete(user).where(eq(user.id, userId));

    const [row] = await db
      .select()
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.id, ticket.id));
    // The work outlives the worker. `cascade` here would mean removing a
    // departing employee's account deleted the lab's maintenance history.
    expect(row).toBeDefined();
    expect(row.assignedToUserId).toBeNull();
    expect(row.assignedToName).toBe("Test Person");
  });

  it("refuses a publication by no user, and keeps the project when they go", async () => {
    await expectViolation(
      db.insert(projects).values({
        slug: "published-by-a-ghost",
        title: "Published By A Ghost",
        published: true,
        publishedAt: new Date(),
        publishedBy: "no-such-user",
      }),
      /projects_published_by_user_id_fk/
    );

    const userId = await insertUser();
    await db.insert(projects).values({
      slug: "published-by-a-leaver",
      title: "Published By A Leaver",
      published: true,
      publishedAt: new Date(),
      publishedBy: userId,
    });

    await db.delete(user).where(eq(user.id, userId));

    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, "published-by-a-leaver"));
    // Still in the gallery: who decided is a fact about the decision, not a
    // condition of it. The moderator's name is in `audit_events`.
    expect(row.published).toBe(true);
    expect(row.publishedBy).toBeNull();
  });
});
