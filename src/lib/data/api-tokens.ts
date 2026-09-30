import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { apiTokens, oauthAccessToken, oauthApplication, oauthConsent, user } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { generateApiToken } from "../auth/api-token-format.ts";
import { isUuid } from "./uuid.ts";
import { TOKEN_LIFETIME_DAYS, tokenExpiryFrom } from "../account/token-lifetime.ts";

/**
 * Personal access tokens and OAuth grants (MCP access spec §4.1, §5.1, §6).
 *
 * `api_tokens` rows are written only here. The token itself is returned
 * **once**, by {@link createApiToken}, and never again: every other read
 * carries the display prefix and nothing that could be replayed. Revoking
 * stamps `revoked_at` rather than deleting the row, so the list can say
 * "revoked" and the audit trail's subject id keeps pointing at something.
 *
 * The OAuth half reads the Better Auth `mcp` plugin's tables — the library
 * writes them — to list a person's "Connected apps" and to revoke one, which
 * deletes that client's access tokens and consent for that person.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

export interface ApiTokenOptions {
  db?: Db;
}

/** Every token lives 90 days — one semester, no choice (amendment 2026-09-25). */
export { TOKEN_LIFETIME_DAYS, tokenExpiryFrom };

/** Live (unrevoked, unexpired) tokens one person may hold. A ceiling, not a quota anybody should meet. */
export const MAX_ACTIVE_TOKENS = 20;

/** Longest token name kept. */
export const TOKEN_NAME_MAX = 80;

/** `last_used_at` moves at most this often (§4.1). */
const LAST_USED_RESOLUTION = sql`interval '1 minute'`;

/** One token as its owner's page lists it. Never the token or its hash. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface NewApiToken {
  userId: string;
  name: string;
  readOnly: boolean;
}

export type CreateApiTokenResult =
  | { ok: true; token: string; summary: ApiTokenSummary }
  | { ok: false; reason: "invalid_field" | "too_many_tokens" };


/**
 * Create a token for `userId`. Answers the token itself — the only time it
 * exists outside its owner's clipboard — and the summary the page lists.
 */
export async function createApiToken(
  input: NewApiToken,
  options: ApiTokenOptions = {}
): Promise<CreateApiTokenResult> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name || name.length > TOKEN_NAME_MAX) return { ok: false, reason: "invalid_field" };

  const db = options.db ?? (await getDb());
  const active = await countActiveTokens(input.userId, { db });
  if (active >= MAX_ACTIVE_TOKENS) return { ok: false, reason: "too_many_tokens" };

  const generated = generateApiToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId: input.userId,
      name,
      prefix: generated.prefix,
      tokenHash: generated.hash,
      readOnly: input.readOnly,
      expiresAt: tokenExpiryFrom(),
    })
    .returning();

  return { ok: true, token: generated.token, summary: toSummary(row) };
}

/** A person's tokens, live ones first, newest first within each. */
export async function listApiTokens(userId: string, options: ApiTokenOptions = {}): Promise<ApiTokenSummary[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(sql`${apiTokens.revokedAt} is not null`, desc(apiTokens.createdAt))
    .limit(100);
  return rows.map(toSummary);
}

async function countActiveTokens(userId: string, options: ApiTokenOptions): Promise<number> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`))
      )
    );
  return row?.n ?? 0;
}

export type RevokeApiTokenResult =
  | { ok: true; summary: ApiTokenSummary }
  | { ok: false; reason: "not_found" | "already_revoked" };

/**
 * Revoke one of `userId`'s tokens. The owner is part of the `where`: a token
 * id copied from somebody else's page revokes nothing and says "not found".
 */
export async function revokeApiToken(
  userId: string,
  tokenId: string,
  options: ApiTokenOptions = {}
): Promise<RevokeApiTokenResult> {
  if (!isUuid(tokenId)) return { ok: false, reason: "not_found" };
  const db = options.db ?? (await getDb());
  const [updated] = await db
    .update(apiTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning();
  if (updated) return { ok: true, summary: toSummary(updated) };

  const [existing] = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
  return { ok: false, reason: existing ? "already_revoked" : "not_found" };
}

// ── Resolving a bearer ──────────────────────────────────────────────

/** The person a bearer credential names, as the identity resolver needs them. */
export interface BearerUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string | null;
  banned: boolean | null;
}

export type TokenLookup =
  | { found: false }
  | {
      found: true;
      tokenId: string;
      prefix: string;
      readOnly: boolean;
      revoked: boolean;
      expired: boolean;
      user: BearerUser;
    };

/** The token with this hash and its owner, with its state computed by Postgres. */
export async function findApiTokenByHash(hash: string, options: ApiTokenOptions = {}): Promise<TokenLookup> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      prefix: apiTokens.prefix,
      readOnly: apiTokens.readOnly,
      revoked: sql<boolean>`${apiTokens.revokedAt} is not null`,
      expired: sql<boolean>`coalesce(${apiTokens.expiresAt} <= now(), false)`,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        banned: user.banned,
      },
    })
    .from(apiTokens)
    .innerJoin(user, eq(apiTokens.userId, user.id))
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);
  if (!row) return { found: false };
  return { found: true, ...row };
}

/**
 * Stamp `last_used_at`, at most once a minute (§4.1) — the condition is in the
 * `where`, so a busy client costs one no-op update per call, not a write.
 * Never throws: a missed stamp is not a reason to fail the call it describes.
 */
export async function touchApiToken(tokenId: string, options: ApiTokenOptions = {}): Promise<void> {
  try {
    const db = options.db ?? (await getDb());
    await db
      .update(apiTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, sql`now() - ${LAST_USED_RESOLUTION}`))
        )
      );
  } catch (err) {
    console.warn("[api-tokens] could not record last use", err instanceof Error ? err.message : "unknown error");
  }
}

export type OAuthLookup =
  | { found: false }
  | { found: true; clientId: string; scopes: string[]; expired: boolean; user: BearerUser | null };

/**
 * The OAuth access token the `mcp` plugin issued with this value. Read here
 * rather than through `auth.api.getMcpSession` because the plugin answers null
 * for an expired token and an unknown one alike, and the route has to tell the
 * client which (§3.1). The plugin stores the token as issued, so this is an
 * equality on its unique column.
 */
export async function findOAuthAccessToken(accessToken: string, options: ApiTokenOptions = {}): Promise<OAuthLookup> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({
      clientId: oauthAccessToken.clientId,
      scopes: oauthAccessToken.scopes,
      expired: sql<boolean>`${oauthAccessToken.accessTokenExpiresAt} <= now()`,
      disabled: oauthApplication.disabled,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        banned: user.banned,
      },
    })
    .from(oauthAccessToken)
    .leftJoin(user, eq(oauthAccessToken.userId, user.id))
    .leftJoin(oauthApplication, eq(oauthAccessToken.clientId, oauthApplication.clientId))
    .where(eq(oauthAccessToken.accessToken, accessToken))
    .limit(1);
  if (!row || row.disabled) return { found: false };
  return {
    found: true,
    clientId: row.clientId,
    scopes: row.scopes.split(/\s+/).filter(Boolean),
    expired: row.expired,
    user: row.user?.id ? row.user : null,
  };
}

// ── Connected apps (OAuth grants) ───────────────────────────────────

/** One OAuth client a person has signed in to MakerLab from. */
export interface ConnectedApp {
  clientId: string;
  name: string | null;
  readOnly: boolean;
  /** When the most recent access token was issued. */
  lastIssuedAt: Date;
}

/**
 * The clients holding a grant for `userId` — any access token (live or
 * refreshable) or recorded consent. Newest first.
 */
export async function listConnectedApps(userId: string, options: ApiTokenOptions = {}): Promise<ConnectedApp[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      clientId: oauthAccessToken.clientId,
      name: oauthApplication.name,
      readOnly: sql<boolean>`bool_or(${oauthAccessToken.scopes} ~ '(^| )read_only( |$)')`,
      lastIssuedAt: sql<Date>`max(${oauthAccessToken.createdAt})`,
    })
    .from(oauthAccessToken)
    .leftJoin(oauthApplication, eq(oauthAccessToken.clientId, oauthApplication.clientId))
    .where(eq(oauthAccessToken.userId, userId))
    .groupBy(oauthAccessToken.clientId, oauthApplication.name)
    .orderBy(desc(sql`max(${oauthAccessToken.createdAt})`), asc(oauthAccessToken.clientId));
  return rows.map((row) => ({
    clientId: row.clientId,
    name: row.name,
    readOnly: Boolean(row.readOnly),
    lastIssuedAt: new Date(row.lastIssuedAt),
  }));
}

/** The name a client registered with, or null. */
export async function oauthClientName(clientId: string, options: ApiTokenOptions = {}): Promise<string | null | undefined> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ name: oauthApplication.name })
    .from(oauthApplication)
    .where(eq(oauthApplication.clientId, clientId))
    .limit(1);
  return row ? row.name : undefined;
}

/**
 * Revoke a client's access for `userId`: its access and refresh tokens and the
 * consent that issued them. The next call with any of them is a 401, and the
 * client has to send the person through sign-in and consent again.
 */
export async function revokeConnectedApp(
  userId: string,
  clientId: string,
  options: ApiTokenOptions = {}
): Promise<{ ok: true; name: string | null } | { ok: false; reason: "not_found" }> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)))
      .returning({ id: oauthAccessToken.id });
    const consents = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .returning({ id: oauthConsent.id });
    if (removed.length === 0 && consents.length === 0) return { ok: false as const, reason: "not_found" as const };
    const name = (await oauthClientName(clientId, { db: tx as unknown as Db })) ?? null;
    return { ok: true as const, name };
  });
}

function toSummary(row: typeof apiTokens.$inferSelect): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    readOnly: row.readOnly,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
