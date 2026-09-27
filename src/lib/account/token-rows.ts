import type { ApiTokenSummary, ConnectedApp } from "../data/api-tokens";

/**
 * What `/account/tokens` hands its islands: the data module's rows with dates
 * as ISO strings, so they cross the server/client boundary as plain JSON.
 * Directive-free on purpose — the page (server) and the islands (client) both
 * import it.
 */

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ConnectedAppRow {
  clientId: string;
  name: string | null;
  readOnly: boolean;
  lastIssuedAt: string;
}

const iso = (value: Date | string | null): string | null => (value ? new Date(value).toISOString() : null);

export function toTokenRow(summary: ApiTokenSummary): TokenRow {
  return {
    id: summary.id,
    name: summary.name,
    prefix: summary.prefix,
    readOnly: summary.readOnly,
    expiresAt: iso(summary.expiresAt),
    lastUsedAt: iso(summary.lastUsedAt),
    revokedAt: iso(summary.revokedAt),
    createdAt: new Date(summary.createdAt).toISOString(),
  };
}

export function toConnectedAppRow(app: ConnectedApp): ConnectedAppRow {
  return {
    clientId: app.clientId,
    name: app.name,
    readOnly: app.readOnly,
    lastIssuedAt: new Date(app.lastIssuedAt).toISOString(),
  };
}
