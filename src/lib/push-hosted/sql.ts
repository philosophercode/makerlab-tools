/**
 * The one database operation `data:push` needs, over either driver: a query on
 * a single connection (so `BEGIN … COMMIT` spans every statement).
 *
 * PGlite is one connection by construction; for Neon the script checks one
 * client out of the pool and holds it for the whole run. Both return
 * `{ rows }`, with jsonb already parsed.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

interface RowsQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export function sqlClient(connection: RowsQueryable): SqlClient {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const result = await connection.query(text, params);
      return result.rows as T[];
    },
  };
}

/** `"name"`, with embedded quotes doubled. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
