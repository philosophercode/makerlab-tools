"use client";

import "../../styles/admin-mirror.css";

import { useId, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MIRROR_ENTITY, type MirrorEntity } from "../../lib/db/schema/vocabulary";
import type { MappingProblem, MirrorMapping as MirrorMappingValue } from "../../lib/mirror/types";
import {
  mirrorErrorMessageKey,
  type MirrorActionFailure,
  type MirrorActions,
  type MirrorMappingInput,
} from "../../app/admin/mirror/action-result";
import { useRefreshNudge } from "./use-refresh-nudge";

/**
 * The mirror's databases, one per table (spec §3.8 "Mapping", §5.8).
 *
 * The fixed list of seven, in the order the push writes them (`MIRROR_ENTITY`
 * is declared in dependency order), each with its Notion database id or "Not
 * set". **Create databases** makes every missing one under the connected page
 * — which is also how a database somebody deleted by hand comes back (§5.8):
 * only the missing ones are made. An admin who already has databases pastes
 * their URLs instead, and **Save mapping** checks each against the schema the
 * push writes, saving nothing unless every one matches; a mismatch names the
 * properties that are missing or of the wrong type, under the table it is
 * about.
 *
 * **A partial create is said, not hidden** (Article 4). Creation that stops
 * part-way has still made databases and written them into the mapping; the
 * refusal names them, and the page's re-render shows their ids.
 *
 * `editable` is false when there is no working token: the mapping is kept and
 * shown, so reconnecting creates no duplicates, but nothing can change it
 * until the token does.
 */

export type MirrorMappingActions = Pick<MirrorActions, "createDatabases" | "saveMapping">;

export interface MirrorMappingProps {
  mapping: MirrorMappingValue;
  editable: boolean;
  actions: MirrorMappingActions;
}

type CreateOutcome =
  | { kind: "created"; count: number }
  | { kind: "failed"; failure: MirrorActionFailure };

type SaveOutcome = { kind: "saved" } | { kind: "failed"; failure: MirrorActionFailure };

const EMPTY_PASTE: Record<MirrorEntity, string> = Object.fromEntries(
  MIRROR_ENTITY.map((entity) => [entity, ""])
) as Record<MirrorEntity, string>;

export function MirrorMapping({ mapping, editable, actions }: MirrorMappingProps) {
  const t = useTranslations("admin");
  const format = useFormatter();
  const formId = useId();
  const nudge = useRefreshNudge();

  const [busy, setBusy] = useState<"create" | "save" | null>(null);
  const [created, setCreated] = useState<CreateOutcome | null>(null);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [paste, setPaste] = useState<Record<MirrorEntity, string>>(EMPTY_PASTE);

  const entityName = (entity: MirrorEntity) => t(`mirror.entities.${entity}`);
  const names = (entities: MirrorEntity[]) => format.list(entities.map(entityName));

  async function create() {
    setBusy("create");
    setCreated(null);
    setSaved(null);
    try {
      const result = await actions.createDatabases();
      setCreated(result.ok ? { kind: "created", count: result.created.length } : { kind: "failed", failure: result });
      // New ids are in the mapping, even after a partial create; see `use-refresh-nudge.ts`.
      if (result.ok || (result.created?.length ?? 0) > 0) nudge();
    } catch {
      setCreated({ kind: "failed", failure: { ok: false, error: "failed" } });
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setSaved(null);
    setCreated(null);
    const input: MirrorMappingInput = {};
    for (const entity of MIRROR_ENTITY) {
      const value = paste[entity].trim();
      if (value) input[entity] = value;
    }
    try {
      const result = await actions.saveMapping(input);
      if (result.ok) {
        setSaved({ kind: "saved" });
        setPaste(EMPTY_PASTE);
        nudge();
      } else {
        setSaved({ kind: "failed", failure: result });
      }
    } catch {
      setSaved({ kind: "failed", failure: { ok: false, error: "failed" } });
    } finally {
      setBusy(null);
    }
  }

  const problems = new Map<MirrorEntity, MappingProblem>();
  if (saved?.kind === "failed") for (const problem of saved.failure.problems ?? []) problems.set(problem.entity, problem);

  function problemLines(problem: MappingProblem): string[] {
    const lines = [t(`mirror.mapping.problems.${problem.code}`)];
    if (problem.missing?.length) lines.push(t("mirror.mapping.missing", { names: format.list(problem.missing) }));
    if (problem.wrongType?.length) lines.push(t("mirror.mapping.wrongType", { names: format.list(problem.wrongType) }));
    return lines;
  }

  let createLine: string | null = null;
  let createTone = "";
  if (created?.kind === "created") {
    createLine =
      created.count > 0 ? t("mirror.mapping.created", { count: created.count }) : t("mirror.mapping.allExisted");
    createTone = " is-ok";
  } else if (created?.kind === "failed") {
    const { failure } = created;
    const parts = [t(mirrorErrorMessageKey(failure.error))];
    if (failure.entity) parts.push(t("mirror.mapping.stoppedAt", { entity: entityName(failure.entity) }));
    if (failure.created?.length) {
      parts.push(
        t("mirror.mapping.createdBeforeStopping", { count: failure.created.length, names: names(failure.created) })
      );
    }
    createLine = parts.join(" ");
    // Something was made, so this is not a clean refusal: warn rather than err.
    createTone = failure.created?.length ? " is-warning" : " is-error";
  }

  return (
    <section className="admin-mirror-panel" aria-labelledby="mirror-mapping-title">
      <h3 id="mirror-mapping-title">{t("mirror.mapping.title")}</h3>

      <table className="admin-mirror-mapping" aria-label={t("mirror.mapping.tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("mirror.mapping.columnTable")}</th>
            <th scope="col">{t("mirror.mapping.columnDatabase")}</th>
          </tr>
        </thead>
        <tbody>
          {MIRROR_ENTITY.map((entity) => (
            <tr key={entity}>
              <th scope="row">{entityName(entity)}</th>
              <td>
                {mapping[entity] ? (
                  <code>{mapping[entity]}</code>
                ) : (
                  <span className="admin-mirror-unset">{t("mirror.mapping.notSet")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editable ? (
        <>
          <p className="admin-mirror-hint">{t("mirror.mapping.createHint")}</p>
          <div className="admin-mirror-actions">
            <button
              type="button"
              className="admin-button is-primary"
              disabled={busy !== null}
              onClick={() => void create()}
            >
              {busy === "create" ? t("mirror.mapping.creating") : t("mirror.mapping.create")}
            </button>
          </div>
          <p className={`admin-mirror-line${createTone}`} role="status">
            {createLine}
          </p>

          <details className="admin-mirror-paste">
            <summary>{t("mirror.mapping.pasteTitle")}</summary>
            <form className="admin-mirror-form" onSubmit={(event) => void save(event)} noValidate>
              <p className="admin-mirror-hint">{t("mirror.mapping.pasteHint")}</p>
              <div className="admin-mirror-paste-fields">
                {MIRROR_ENTITY.map((entity) => {
                  const id = `${formId}-${entity}`;
                  const problem = problems.get(entity);
                  return (
                    <div className="admin-field" key={entity}>
                      <label htmlFor={id}>{t("mirror.mapping.pasteLabel", { entity: entityName(entity) })}</label>
                      <input
                        id={id}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? `${id}-problem` : undefined}
                        value={paste[entity]}
                        onChange={(event) => setPaste((current) => ({ ...current, [entity]: event.target.value }))}
                      />
                      {problem ? (
                        <ul id={`${id}-problem`} className="admin-mirror-problems">
                          {problemLines(problem).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="admin-mirror-actions">
                <button type="submit" className="admin-button" disabled={busy !== null}>
                  {busy === "save" ? t("mirror.mapping.saving") : t("mirror.mapping.save")}
                </button>
              </div>
              <p
                className={`admin-mirror-line${saved?.kind === "saved" ? " is-ok" : saved ? " is-error" : ""}`}
                role="status"
              >
                {saved?.kind === "saved"
                  ? t("mirror.mapping.saved")
                  : saved?.kind === "failed"
                    ? t(mirrorErrorMessageKey(saved.failure.error))
                    : null}
              </p>
            </form>
          </details>
        </>
      ) : (
        <p className="admin-mirror-hint">{t("mirror.mapping.readOnly")}</p>
      )}
    </section>
  );
}
