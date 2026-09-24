"use client";

import "../../styles/admin-mirror.css";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AdminActionWarning } from "../../lib/admin/action-result";
import {
  mirrorErrorMessageKey,
  type MirrorActionError,
  type MirrorActions,
} from "../../app/admin/mirror/action-result";
import { useRefreshNudge } from "./use-refresh-nudge";

/**
 * **Connect** (spec §3.8 "Connect", §4.14, §8).
 *
 * A token field and the URL of the page the integration was shared with.
 * **Test connection** reads that page and shows its title, storing nothing;
 * **Connect** makes the same read and, only if it succeeds, stores the token
 * encrypted. Both are server actions the page hands in, so this island never
 * imports an endpoint.
 *
 * **The token lives in this component's state and nowhere else on the page.**
 * The field is `type="password"` with autocomplete off, so the browser neither
 * shows nor offers to remember it; it is cleared the moment a connect succeeds;
 * and no server answer ever carries it back, so nothing here could echo it
 * into a message. On a refusal it stays in the box, because the person is about
 * to fix the *page* half as often as the token half.
 *
 * Every sentence follows an awaited result — a found title, a refusal, a lost
 * audit event — and never precedes it (Article 4).
 */

export type MirrorConnectActions = Pick<MirrorActions, "testConnection" | "connect">;

export interface MirrorConnectProps {
  actions: MirrorConnectActions;
  /** A page to start from — the mirror's current page when reconnecting. */
  initialPageUrl?: string;
}

type Outcome =
  | { kind: "found"; title: string | null }
  | { kind: "connected"; title: string | null; warning: AdminActionWarning | null }
  | { kind: "error"; error: MirrorActionError };

export function MirrorConnect({ actions, initialPageUrl = "" }: MirrorConnectProps) {
  const t = useTranslations("admin");
  const nudge = useRefreshNudge();
  const tokenId = useId();
  const pageId = useId();
  const tokenHintId = `${tokenId}-hint`;
  const pageHintId = `${pageId}-hint`;

  const [token, setToken] = useState("");
  const [pageUrl, setPageUrl] = useState(initialPageUrl);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const filled = token.trim().length > 0 && pageUrl.trim().length > 0;

  async function test() {
    setBusy("test");
    setOutcome(null);
    try {
      const result = await actions.testConnection({ token, pageUrl });
      setOutcome(result.ok ? { kind: "found", title: result.title } : { kind: "error", error: result.error });
    } catch {
      setOutcome({ kind: "error", error: "failed" });
    } finally {
      setBusy(null);
    }
  }

  async function connect(event?: FormEvent) {
    event?.preventDefault();
    if (!filled || busy) return;
    setBusy("connect");
    setOutcome(null);
    try {
      const result = await actions.connect({ token, pageUrl });
      if (result.ok) {
        setToken("");
        setOutcome({ kind: "connected", title: result.title, warning: result.warning ?? null });
        // The page moves to its connected state; see `use-refresh-nudge.ts`.
        nudge();
      } else {
        setOutcome({ kind: "error", error: result.error });
      }
    } catch {
      setOutcome({ kind: "error", error: "failed" });
    } finally {
      setBusy(null);
    }
  }

  function edited() {
    // A title found for what was typed before says nothing about what is typed now.
    if (outcome) setOutcome(null);
  }

  let line: string | null = null;
  let tone = "";
  if (outcome?.kind === "found") {
    line = outcome.title ? t("mirror.connect.found", { title: outcome.title }) : t("mirror.connect.foundUntitled");
    tone = " is-ok";
  } else if (outcome?.kind === "connected") {
    line = outcome.warning
      ? t(`warnings.${outcome.warning}`)
      : outcome.title
        ? t("mirror.connect.connected", { title: outcome.title })
        : t("mirror.connect.connectedUntitled");
    tone = outcome.warning ? " is-warning" : " is-ok";
  } else if (outcome?.kind === "error") {
    line = t(mirrorErrorMessageKey(outcome.error));
    tone = " is-error";
  }

  return (
    <section className="admin-mirror-panel" aria-labelledby="mirror-connect-title">
      <h3 id="mirror-connect-title">{t("mirror.connect.title")}</h3>
      <form className="admin-mirror-form" onSubmit={(event) => void connect(event)} noValidate>
        <div className="admin-field">
          <label htmlFor={tokenId}>{t("mirror.connect.tokenLabel")}</label>
          <input
            id={tokenId}
            type="password"
            name="notion-token"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-describedby={tokenHintId}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              edited();
            }}
          />
          <span id={tokenHintId} className="admin-mirror-field-hint">
            {t("mirror.connect.tokenHint")}
          </span>
        </div>
        <div className="admin-field">
          <label htmlFor={pageId}>{t("mirror.connect.pageLabel")}</label>
          <input
            id={pageId}
            type="url"
            name="notion-page"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={pageHintId}
            value={pageUrl}
            onChange={(event) => {
              setPageUrl(event.target.value);
              edited();
            }}
          />
          <span id={pageHintId} className="admin-mirror-field-hint">
            {t("mirror.connect.pageHint")}
          </span>
        </div>
        <div className="admin-mirror-actions">
          <button
            type="button"
            className="admin-button"
            disabled={!filled || busy !== null}
            onClick={() => void test()}
          >
            {busy === "test" ? t("mirror.connect.testing") : t("mirror.connect.test")}
          </button>
          <button type="submit" className="admin-button is-primary" disabled={!filled || busy !== null}>
            {busy === "connect" ? t("mirror.connect.connecting") : t("mirror.connect.connect")}
          </button>
        </div>
        <p className={`admin-mirror-line${tone}`} role="status">
          {line}
        </p>
      </form>
    </section>
  );
}
