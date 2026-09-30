import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/**
 * MCP access (MCP access spec §4; migration `0014`).
 *
 * `api_tokens` — **personal access tokens**. A signed-in person creates one on
 * `/account/tokens` and an MCP client sends it as `Authorization: Bearer
 * mlt_…`; a call made with it acts as that person, with their role's
 * permissions and never more (a read-only token has less). Only the SHA-256
 * hash of the token is stored — the token itself is shown once and then exists
 * only wherever its owner pasted it. `prefix` is the first eight characters
 * after `mlt_`, the one part that may appear in a log line or on the page.
 * Deleting the person deletes their tokens (`cascade`), which is revoking them.
 *
 * The three `oauth_*` tables belong to Better Auth's `mcp` plugin (the OAuth
 * sign-in MCP clients such as claude.ai use). As with `auth.ts`, **the property
 * keys are Better Auth's field names** — the Drizzle adapter resolves a field
 * by looking its JavaScript name up on the table — and the field list is taken
 * from `better-auth/dist/plugins/oidc-provider/schema.mjs`, the schema the
 * `mcp` plugin registers. The library writes these rows; the app reads them to
 * resolve a bearer token and to list and revoke "Connected apps". `name` and
 * the other descriptive columns are nullable because dynamic client
 * registration may omit them.
 *
 * Relative imports with `.ts` extensions: scripts load the schema under plain
 * Node.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    readOnly: boolean("read_only").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)]
);

/** An OAuth client an MCP client registered (dynamic client registration). */
export const oauthApplication = pgTable(
  "oauth_application",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    icon: text("icon"),
    metadata: text("metadata"),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    redirectUrls: text("redirect_urls").notNull(),
    type: text("type").notNull(),
    disabled: boolean("disabled").default(false),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_application_user_idx").on(t.userId)]
);

/** An access token the plugin issued to a client on a person's behalf. */
export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    accessToken: text("access_token").notNull().unique(),
    refreshToken: text("refresh_token").unique(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_user_idx").on(t.userId),
  ]
);

/** A person's recorded consent to a client. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull().default(""),
    consentGiven: boolean("consent_given").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
  ]
);
