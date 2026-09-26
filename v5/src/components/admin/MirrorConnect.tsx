"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AdminActionWarning } from "../../lib/admin/action-result";
import {
  mirrorErrorMessageKey,
  type MirrorActionError,
  type MirrorActions,
} from "../../app/admin/mirror/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, hintId } from "../system/Field";
import { RowStatus, type RowStatusTone } from "./RowStatus";
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
  let tone: RowStatusTone = "muted";
  if (outcome?.kind === "found") {
    line = outcome.title ? t("mirror.connect.found", { title: outcome.title }) : t("mirror.connect.foundUntitled");
    tone = "ok";
  } else if (outcome?.kind === "connected") {
    line = outcome.warning
      ? t(`warnings.${outcome.warning}`)
      : outcome.title
        ? t("mirror.connect.connected", { title: outcome.title })
        : t("mirror.connect.connectedUntitled");
    tone = outcome.warning ? "warn" : "ok";
  } else if (outcome?.kind === "error") {
    line = t(mirrorErrorMessageKey(outcome.error));
    tone = "bad";
  }

  return (
    <section className="ui flex flex-col gap-3 border-t border-rule pt-4" aria-labelledby="mirror-connect-title">
      <h3 id="mirror-connect-title" className="font-heading text-lg font-medium uppercase">
        {t("mirror.connect.title")}
      </h3>
      <form className="flex max-w-xl flex-col gap-3" onSubmit={(event) => void connect(event)} noValidate>
        <Field id={tokenId} label={t("mirror.connect.tokenLabel")} hint={t("mirror.connect.tokenHint")}>
          <Input
            id={tokenId}
            type="password"
            name="notion-token"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-describedby={hintId(tokenId)}
            className="font-mono"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              edited();
            }}
          />
        </Field>
        <Field id={pageId} label={t("mirror.connect.pageLabel")} hint={t("mirror.connect.pageHint")}>
          <Input
            id={pageId}
            type="url"
            name="notion-page"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hintId(pageId)}
            value={pageUrl}
            onChange={(event) => {
              setPageUrl(event.target.value);
              edited();
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={!filled || busy !== null} onClick={() => void test()}>
            {busy === "test" ? t("mirror.connect.testing") : t("mirror.connect.test")}
          </Button>
          <Button type="submit" variant="default" disabled={!filled || busy !== null}>
            {busy === "connect" ? t("mirror.connect.connecting") : t("mirror.connect.connect")}
          </Button>
        </div>
        <RowStatus tone={tone} as="p" className="text-sm">
          {line}
        </RowStatus>
      </form>
    </section>
  );
}
