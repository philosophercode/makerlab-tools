// @vitest-environment node
import { getTableName } from "drizzle-orm";
import {
  account,
  apiTokens,
  manualChunks,
  manualDocuments,
  manualPages,
  notionMirrors,
  oauthAccessToken,
  oauthApplication,
  session,
  tools,
  user,
  verification,
} from "../db/schema/index";
import { DEPLOYMENT_BOUND, EXCLUDED_TABLES, isDeploymentBound, isExcludedFromBackup, isRebuiltAfterRestore, isRetentionBound, REBUILT_AFTER_RESTORE, RETENTION_BOUND, redactRows } from "./backup-policy";
import { staffShifts } from "../db/schema/staff-shifts";
import { starterAnswers } from "../db/schema/starter-answers";
import { chatIllustrations } from "../db/schema/illustrations";
import { usageEvents, usageGaps, usageRollups } from "../db/schema/usage";

/**
 * The policy is small enough to read, so these tests assert the *decision*
 * rather than the mechanism: what a nightly file may and may not contain. If a
 * later phase widens `EXCLUDED_TABLES` or the redaction map, these are the
 * assertions that should have to be rewritten on purpose.
 */

describe("RETENTION_BOUND (usage insight spec §4, §8)", () => {
  it("holds back raw usage events and the Unanswered queue, and nothing else", () => {
    expect(isRetentionBound(usageEvents)).toBe(true);
    expect(isRetentionBound(usageGaps)).toBe(true);
    expect(RETENTION_BOUND.size).toBe(2);
  });

  it("keeps the hourly counts, which name nobody", () => {
    expect(isRetentionBound(usageRollups)).toBe(false);
    expect(isExcludedFromBackup(usageRollups)).toBe(false);
  });
});

describe("DEPLOYMENT_BOUND (starter answers, staff shifts, chat illustrations)", () => {
  it("keeps who is on shift out of data:push, so a local test shift never reaches the live site, but in the nightly backup", () => {
    expect(isDeploymentBound(staffShifts)).toBe(true);
    expect(isExcludedFromBackup(staffShifts)).toBe(false);
  });

  it("keeps pre-run starter answers out of data:push but in the nightly backup", () => {
    expect(isDeploymentBound(starterAnswers)).toBe(true);
    expect(DEPLOYMENT_BOUND.size).toBe(3);
    expect(isExcludedFromBackup(starterAnswers)).toBe(false);
    expect(isRetentionBound(starterAnswers)).toBe(false);
    expect(isRebuiltAfterRestore(starterAnswers)).toBe(false);
  });

  it("keeps chat illustrations out of data:push (their blobs are the deployment's own) but in the nightly backup", () => {
    expect(isDeploymentBound(chatIllustrations)).toBe(true);
    expect(isExcludedFromBackup(chatIllustrations)).toBe(false);
    expect(isRetentionBound(chatIllustrations)).toBe(false);
  });
});

describe("EXCLUDED_TABLES", () => {
  it("skips the three tables whose rows are live credentials", () => {
    expect(isExcludedFromBackup(session)).toBe(true);
    expect(isExcludedFromBackup(verification)).toBe(true);
    // The `mcp` plugin's OAuth access and refresh tokens (MCP access spec).
    expect(isExcludedFromBackup(oauthAccessToken)).toBe(true);
    expect(EXCLUDED_TABLES.size).toBe(3);
  });

  it("keeps personal access tokens — hashes, never a token — and OAuth clients without their secret", () => {
    expect(isExcludedFromBackup(apiTokens)).toBe(false);
    expect(isExcludedFromBackup(oauthApplication)).toBe(false);
    const [row] = redactRows(getTableName(oauthApplication), [{ clientId: "c", clientSecret: "s", name: "Claude" }]) as Record<string, unknown>[];
    expect(row).toEqual({ clientId: "c", clientSecret: null, name: "Claude" });
  });

  it("keeps `user`, because role and ban state are what a restore needs", () => {
    expect(isExcludedFromBackup(user)).toBe(false);
  });

  it("keeps `account`, because the provider link is not a secret", () => {
    expect(isExcludedFromBackup(account)).toBe(false);
  });

  it("keeps an ordinary catalogue table", () => {
    expect(isExcludedFromBackup(tools)).toBe(false);
  });
});

describe("REBUILT_AFTER_RESTORE", () => {
  it("names the manual search tables, which manuals:index rebuilds from the stored PDFs", () => {
    expect(isRebuiltAfterRestore(manualPages)).toBe(true);
    expect(isRebuiltAfterRestore(manualChunks)).toBe(true);
    expect(REBUILT_AFTER_RESTORE.size).toBe(2);
  });

  it("keeps the document rows, which hold each manual's outline and status", () => {
    expect(isRebuiltAfterRestore(manualDocuments)).toBe(false);
  });

  it("is not a credential exclusion, so data:push still copies them", () => {
    expect(isExcludedFromBackup(manualPages)).toBe(false);
    expect(isExcludedFromBackup(manualChunks)).toBe(false);
  });
});

describe("redactRows", () => {
  const accountRow = {
    id: "acc-1",
    accountId: "google-sub-1",
    providerId: "google",
    userId: "user-1",
    accessToken: "ya29.live-access-token",
    refreshToken: "1//live-refresh-token",
    idToken: "eyJ.live-id-token",
    password: "argon2-hash",
    scope: "openid email profile",
  };

  it("blanks every account secret, keeping the link that identifies the person", () => {
    const [row] = redactRows(getTableName(account), [accountRow]) as Record<string, unknown>[];

    expect(row.accessToken).toBeNull();
    expect(row.refreshToken).toBeNull();
    expect(row.idToken).toBeNull();
    expect(row.password).toBeNull();

    // The half that a restore actually needs survives untouched.
    expect(row.accountId).toBe("google-sub-1");
    expect(row.providerId).toBe("google");
    expect(row.userId).toBe("user-1");
    expect(row.scope).toBe("openid email profile");
  });

  it("nulls the column rather than dropping the key", () => {
    const [row] = redactRows(getTableName(account), [accountRow]) as Record<string, unknown>[];

    // A missing key reads as "this backup predates the column", which is a
    // different and more confusing thing to hand somebody mid-restore.
    expect("accessToken" in row).toBe(true);
  });

  it("does not mutate the row it was given", () => {
    redactRows(getTableName(account), [accountRow]);

    expect(accountRow.accessToken).toBe("ya29.live-access-token");
  });

  it("blanks a mirror's Notion token and keeps what a restore needs", () => {
    const mirrorRow = {
      id: "m-1",
      ownerUserId: "user-1",
      tokenCiphertext: Buffer.from([1, 2, 3, 4]),
      parentPageId: "page-1",
      mapping: { tools: "db-1" },
      lastStatus: "ok",
    };

    const [row] = redactRows(getTableName(notionMirrors), [mirrorRow]) as Record<string, unknown>[];

    // Decryptable by anyone who also holds AUTH_SECRET, and a Buffer besides.
    expect(row.tokenCiphertext).toBeNull();
    expect("tokenCiphertext" in row).toBe(true);
    expect(row.ownerUserId).toBe("user-1");
    expect(row.mapping).toEqual({ tools: "db-1" });
    expect(isExcludedFromBackup(notionMirrors)).toBe(false);
  });

  it("passes a table with no redactions straight through", () => {
    const rows = [{ id: "t-1", name: "Formlabs Form 3" }];

    expect(redactRows(getTableName(tools), rows)).toBe(rows);
  });
});
