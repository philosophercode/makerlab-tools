/**
 * A database failure, described for a log line without the data that failed
 * to be written (security fix, 2026-10-05; data platform spec amendment of
 * that date).
 *
 * Drizzle wraps every failed query in a `DrizzleQueryError` whose message is
 * `Failed query: <sql>\nparams: <params>` — every bound value, so a reporter's
 * email, a ticket's text or a student's question — and the driver error under
 * it (`cause`) carries a `detail` such as `Key (email)=(…) already exists`.
 * Logging the error, or its message, wrote those values into the runtime logs,
 * where neither the app's roles nor its retention rules reach.
 *
 * This keeps what diagnoses the failure and nothing that came from a person:
 * the error's name, the SQLSTATE code, and the constraint, table and column
 * names Postgres reports. An error that is not a database error keeps its own
 * name and message (they are the app's words, not a row's).
 *
 * Plain Node, no imports.
 */
export function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return `non-Error thrown (${typeof error})`;

  const database = findDatabaseError(error);
  if (!database) {
    return isDrizzleQueryError(error) ? "DrizzleQueryError" : `${error.name}: ${error.message}`;
  }
  const parts = [`SQLSTATE ${database.code}`];
  for (const key of ["constraint", "table", "column"] as const) {
    const value = database[key];
    if (typeof value === "string" && value) parts.push(`${key} ${value}`);
  }
  const name = isDrizzleQueryError(error) ? "DrizzleQueryError" : error.name;
  return `${name} (${parts.join(", ")})`;
}

interface DatabaseErrorFields {
  code: string;
  constraint?: unknown;
  table?: unknown;
  column?: unknown;
}

/** The first error in the cause chain that carries a five-character SQLSTATE. */
function findDatabaseError(error: unknown): DatabaseErrorFields | null {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return current as DatabaseErrorFields;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function isDrizzleQueryError(error: Error): boolean {
  return "params" in error && "query" in error;
}
