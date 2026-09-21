/**
 * Helpers for tests that run against PGlite.
 *
 * Drizzle wraps a failed statement in a `DrizzleQueryError` whose message is
 * "Failed query: …" and whose `cause` carries the driver error — the one that
 * names the violated constraint. `expectViolation` looks there.
 */
export async function expectViolation(promise: Promise<unknown>, constraint: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error(`expected a ${constraint} violation, but the statement succeeded`);
  }
  const error = thrown as { message?: string; cause?: { message?: string } };
  const text = `${error.message ?? ""}\n${error.cause?.message ?? ""}`;
  if (!constraint.test(text)) {
    throw new Error(`expected a ${constraint} violation, got: ${text}`);
  }
}
