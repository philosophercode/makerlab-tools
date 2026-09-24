"use client";

import "../../styles/admin-intake.css";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ApprovePendingAction,
  IntakeActions,
  IntakeApproveResult,
} from "../../app/admin/intake/action-result";
import type { AdminActionWarning } from "../../lib/admin/action-result";
import type { ApprovalFields } from "../../lib/data/pending-tools";
import type { CategoryOption, LocationOption } from "../../lib/data/taxonomy";
import { ADMIN_INTAKE_PATH, type PendingToolView } from "../../lib/intake/types";
import type { ResearchResult } from "../../lib/research/result";
import { ConfidenceStrip, isWebLink } from "../ConfidenceStrip";
import { requestResearch } from "./IntakeList";

/**
 * `/admin/intake/[id]` — the page an admin approves from (spec §5.4 steps
 * 10–12, §6, Article 5).
 *
 * **It shows the proposal, not a verdict.** Research's result arrives as the
 * tool editor's own fields, pre-filled and editable, beside the evidence it
 * rests on: the confidence strip reused from the chat card, the pages research
 * read, the links it verified and the ones it dropped with their reasons, and
 * the photos. Nothing here writes until somebody presses a button.
 *
 * **Low confidence disables both Approve buttons** until the admin either
 * corrects the name and researches again — the page re-renders with the new
 * grade — or ticks "I've checked this" *and* writes a note. The note travels as
 * `overrideNote` and `approvePendingTool` enforces the same rule, so a request
 * that skips this page is refused all the same (§5.4 step 12).
 *
 * **A refusal never costs anybody their typing.** The draft is initialised once
 * from the research and is never replaced by a server value; a refusal shows
 * its reason inline and leaves every box as it was. There is no modal (§6).
 * Every control sits in one `<fieldset>` that is disabled while any write is in
 * flight, so two presses cannot become two tools.
 *
 * **The actions arrive as props** and each re-checks its own permission:
 * hiding **Approve** from somebody without `tools.publish` is presentation.
 * No `useTransition` around them, for the reason `use-row-action.ts` gives:
 * each ends in `revalidatePath`, and a transition would hold the confirmation
 * hostage to the re-render behind it.
 *
 * The component stays mounted when the page re-renders with the item approved
 * or discarded, which is what keeps a success's warning on screen after the
 * server has moved on.
 */

/** The tool an add-unit item joins, or the tool an approval created. */
export interface IntakeToolLink {
  name: string;
  slug: string;
  published: boolean;
}

export interface PreliminaryToolPageProps {
  item: PendingToolView;
  /** Null for an add-unit item, which skipped research. */
  research: ResearchResult | null;
  categories: CategoryOption[];
  locations: LocationOption[];
  /** The existing tool an add-unit item would join. Null when it is gone. */
  targetTool: IntakeToolLink | null;
  /** What an approved item became, when it has been approved. */
  createdTool: IntakeToolLink | null;
  /** Hides **Approve** (published). The action checks `tools.publish` itself. */
  canPublish: boolean;
  actions: IntakeActions;
}

/** The option that creates research's proposed category at approval. */
const NEW_CATEGORY = "__new__";

/** What the reviewer is editing: the proposal as text, the way inputs hold it. */
interface Draft {
  name: string;
  description: string;
  category: string;
  locationId: string;
  materials: string;
  ppeRequired: string;
  tags: string;
  trainingRequired: boolean;
  useRestrictions: string;
  serialNumber: string;
  resourceUrls: string[];
}

/** Which write is in flight. One at a time, and every control knows it. */
type Busy = "approve" | "draft" | "unit" | "discard" | "save" | "research" | null;

/** How the item left the queue, as far as this page saw it happen. */
type Settled =
  | { kind: "approved"; tool: IntakeToolLink; warning: AdminActionWarning | null }
  | { kind: "unit"; tool: IntakeToolLink; warning: AdminActionWarning | null }
  | { kind: "discarded" };

const LIST_FIELDS = ["materials", "ppeRequired", "tags"] as const;

export function PreliminaryToolPage({
  item,
  research,
  categories,
  locations,
  targetTool,
  createdTool,
  canPublish,
  actions,
}: PreliminaryToolPageProps) {
  const t = useTranslations("admin.intake");
  const tAdmin = useTranslations("admin");
  const router = useRouter();

  const isUnit = item.duplicateResolution === "add_unit";

  // Initialised once, never synchronised — see "a refusal never costs
  // anybody their typing" above.
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(item, research, categories, locations)
  );
  const [identity, setIdentity] = useState({ name: item.name, brand: item.brand ?? "" });
  const [unitSerial, setUnitSerial] = useState(item.serialNumber ?? "");
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const [busy, setBusy] = useState<Busy>(null);
  /** A message key under `admin` — `errors.<code>` or `intake.errors.<code>`. */
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);

  // The server's word wins over nothing, and this page's own result wins over
  // the server's: it carries the warning, which the database does not.
  const outcome = settled ?? settledFromProps(item, createdTool, isUnit);
  if (outcome) return <SettledPanel outcome={outcome} />;

  const low = research?.confidence.level === "low";
  const overridden = checked && note.trim() !== "";
  const approvable =
    !isUnit && research !== null && (!low || overridden) && draft.name.trim() !== "";
  const identityDirty =
    identity.name.trim() !== item.name || (identity.brand.trim() || null) !== item.brand;

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleResource(url: string, on: boolean) {
    setDraft((current) => ({
      ...current,
      resourceUrls: on
        ? [...current.resourceUrls, url]
        : current.resourceUrls.filter((candidate) => candidate !== url),
    }));
  }

  /** Run one write with the page locked, and clear the last outcome first. */
  async function write<T>(which: Busy, call: () => Promise<T>): Promise<T | null> {
    setBusy(which);
    setError(null);
    setNotice(null);
    try {
      return await call();
    } catch {
      // A dropped connection or a redeploy mid-click: nothing is known to have
      // landed, and the draft is still here to try again with.
      setError("errors.failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function settle(result: IntakeApproveResult | null, kind: "approved" | "unit", name: string) {
    if (!result) return;
    if (!result.ok) {
      setError(`errors.${result.error}`);
      return;
    }
    setSettled({
      kind,
      tool: { name, slug: result.slug, published: result.published },
      warning: result.warning ?? null,
    });
  }

  async function approve(action: ApprovePendingAction, which: "approve" | "draft") {
    if (!research) return;
    const fields = toFields(draft, research);
    const result = await write(which, () =>
      action({ id: item.id, fields, overrideNote: low ? note.trim() : null })
    );
    settle(result, "approved", fields.name);
  }

  async function addUnit() {
    const result = await write("unit", () =>
      actions.addUnit({ id: item.id, serialNumber: unitSerial.trim() || null })
    );
    settle(result, "unit", targetTool?.name ?? item.name);
  }

  async function discard() {
    const result = await write("discard", () => actions.discard({ id: item.id }));
    setConfirmDiscard(false);
    if (!result) return;
    if (!result.ok) {
      setError(`errors.${result.error}`);
      return;
    }
    setSettled({ kind: "discarded" });
  }

  /** Save the name and brand. Answers whether they are now saved. */
  async function saveIdentity(): Promise<boolean> {
    const result = await write("save", () =>
      actions.saveIdentity({
        id: item.id,
        name: identity.name.trim(),
        brand: identity.brand.trim() || null,
      })
    );
    if (!result) return false;
    if (!result.ok) {
      setError(`errors.${result.error}`);
      return false;
    }
    setNotice(result.warning ? `warnings.${result.warning}` : "saved");
    return true;
  }

  /**
   * **Research again.** A corrected name is saved first — researching the old
   * one would spend the budget confirming the mistake.
   */
  async function researchAgain() {
    if (identityDirty && !(await saveIdentity())) return;
    const code = await write("research", () => requestResearch(item.id));
    if (code) {
      setError(`intake.errors.${code}`);
      return;
    }
    setNotice("intake.researchStarted");
    router.refresh();
  }

  const locked = busy !== null;

  return (
    <div className="admin-intake-page">
      <fieldset className="admin-intake-fieldset" disabled={locked}>
        <legend className="admin-visually-hidden">{t("pageLabel", { name: item.name })}</legend>

        <div className="admin-intake-columns">
          <div className="admin-intake-main">
            {/* Not for an add-unit item: it skipped research, and renaming it
                would only move the duplicate match it was resolved against. */}
            {isUnit ? null : (
              <section className="admin-intake-panel" aria-labelledby="intake-identity-title">
                <h3 id="intake-identity-title">{t("identityTitle")}</h3>
                <p className="admin-intake-hint">{t("identityHint")}</p>
                <div className="admin-intake-identity">
                  <div className="admin-field">
                    <label htmlFor="intake-identity-name">{t("identityName")}</label>
                    <input
                      id="intake-identity-name"
                      value={identity.name}
                      maxLength={200}
                      onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="intake-identity-brand">{t("identityBrand")}</label>
                    <input
                      id="intake-identity-brand"
                      value={identity.brand}
                      maxLength={200}
                      onChange={(event) => setIdentity({ ...identity, brand: event.target.value })}
                    />
                  </div>
                </div>
                {item.duplicateOf ? (
                  <p className="admin-intake-duplicate">
                    {item.duplicateOf.kind === "tool"
                      ? t("duplicateOfTool", { name: item.duplicateOf.name })
                      : t("duplicateOfPending", { name: item.duplicateOf.name })}
                  </p>
                ) : null}
                <div className="admin-editor-actions">
                  <button
                    type="button"
                    className="admin-button"
                    disabled={!identityDirty || identity.name.trim() === ""}
                    onClick={() => void saveIdentity()}
                  >
                    {t("saveIdentity")}
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    disabled={identity.name.trim() === ""}
                    onClick={() => void researchAgain()}
                  >
                    {t("researchAgain")}
                  </button>
                </div>
              </section>
            )}

            {isUnit ? (
              <UnitProposal
                target={targetTool}
                serial={unitSerial}
                onSerial={setUnitSerial}
                onAdd={() => void addUnit()}
              />
            ) : research ? (
              <>
                <ConfidenceStrip
                  confidence={research.confidence}
                  evidence={research.evidence}
                  sourceUrls={research.sourceUrls}
                  unknownsFirst={research.confidence.level !== "high"}
                />

                {low ? (
                  <section
                    className="admin-intake-override"
                    aria-labelledby="intake-override-title"
                  >
                    <h3 id="intake-override-title">{t("lowTitle")}</h3>
                    <p>{t("lowExplain")}</p>
                    <div className="admin-field is-check">
                      <input
                        id="intake-override-check"
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setChecked(event.target.checked)}
                      />
                      <label htmlFor="intake-override-check">{t("overrideCheck")}</label>
                    </div>
                    <div className="admin-field">
                      <label htmlFor="intake-override-note">{t("overrideNote")}</label>
                      <textarea
                        id="intake-override-note"
                        rows={3}
                        maxLength={1000}
                        placeholder={t("overrideNotePlaceholder")}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </div>
                  </section>
                ) : null}

                <ProposedRecord
                  draft={draft}
                  research={research}
                  categories={categories}
                  locations={locations}
                  set={set}
                  toggleResource={toggleResource}
                />
              </>
            ) : (
              <p className="admin-empty td-empty">{t("noResearch")}</p>
            )}

            <div className="admin-editor-actions admin-intake-decision">
              {isUnit ? null : (
                <>
                  {canPublish ? (
                    <button
                      type="button"
                      className="admin-button is-primary"
                      disabled={!approvable}
                      onClick={() => void approve(actions.approve, "approve")}
                    >
                      {t("approve")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="admin-button"
                    disabled={!approvable}
                    onClick={() => void approve(actions.approveAsDraft, "draft")}
                  >
                    {t("approveAsDraft")}
                  </button>
                </>
              )}
              {confirmDiscard ? (
                <span className="admin-intake-confirm">
                  <span>{t("discardConfirm", { name: item.name })}</span>
                  <button
                    type="button"
                    className="admin-button is-danger"
                    onClick={() => void discard()}
                  >
                    {t("discardYes")}
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    {t("discardKeep")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="admin-button is-danger"
                  onClick={() => setConfirmDiscard(true)}
                >
                  {t("discard")}
                </button>
              )}
            </div>

            <p
              className={`admin-row-status admin-intake-status-line${error ? " is-error" : ""}${
                !error && notice?.startsWith("warnings.") ? " is-warning" : ""
              }`}
              role="status"
            >
              {busy ? t(`busy.${busy}`) : null}
              {!busy && error ? tAdmin(error) : null}
              {!busy && !error && notice ? tAdmin(notice) : null}
            </p>
          </div>

          <aside className="admin-intake-side">
            <Photos item={item} />
            {research && !isUnit ? <DroppedLinks research={research} /> : null}
          </aside>
        </div>
      </fieldset>
    </div>
  );
}

/** The proposed record, in the tool editor's fields. */
function ProposedRecord({
  draft,
  research,
  categories,
  locations,
  set,
  toggleResource,
}: {
  draft: Draft;
  research: ResearchResult;
  categories: CategoryOption[];
  locations: LocationOption[];
  set: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  toggleResource: (url: string, on: boolean) => void;
}) {
  const t = useTranslations("admin.intake");
  const tEditor = useTranslations("admin.inventory.editor");
  const proposed = research.category;
  const offersNew =
    proposed.name.trim() !== "" && !categories.some((c) => c.id === proposed.existingId);

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-record-title">
      <h3 id="intake-record-title">{t("recordTitle")}</h3>
      <p className="admin-intake-hint">{t("recordHint")}</p>

      <div className="admin-editor-form">
        <div className="admin-field">
          <label htmlFor="intake-name">{tEditor("fieldName")}</label>
          <input
            id="intake-name"
            value={draft.name}
            required
            maxLength={200}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="intake-description">{tEditor("fieldDescription")}</label>
          <textarea
            id="intake-description"
            rows={8}
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="intake-category">{tEditor("fieldCategory")}</label>
          <select
            id="intake-category"
            value={draft.category}
            onChange={(event) => set("category", event.target.value)}
          >
            <option value="">{tEditor("noneSelected")}</option>
            {offersNew ? (
              <option value={NEW_CATEGORY}>
                {t("newCategory", { name: categoryLabel(proposed.name, proposed.group) })}
              </option>
            ) : null}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category.name, category.group)}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="intake-location">{tEditor("fieldLocation")}</label>
          <select
            id="intake-location"
            value={draft.locationId}
            onChange={(event) => set("locationId", event.target.value)}
          >
            <option value="">{tEditor("noneSelected")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {`${location.room} — ${location.zone}`}
              </option>
            ))}
          </select>
        </div>

        {LIST_FIELDS.map((field) => (
          <div className="admin-field" key={field}>
            <label htmlFor={`intake-${field}`}>{tEditor(`field_${field}`)}</label>
            <input
              id={`intake-${field}`}
              value={draft[field]}
              placeholder={tEditor("listPlaceholder")}
              onChange={(event) => set(field, event.target.value)}
            />
          </div>
        ))}

        <div className="admin-field is-check">
          <input
            id="intake-training-required"
            type="checkbox"
            checked={draft.trainingRequired}
            onChange={(event) => set("trainingRequired", event.target.checked)}
          />
          <label htmlFor="intake-training-required">{tEditor("fieldTrainingRequired")}</label>
        </div>

        <div className="admin-field">
          <label htmlFor="intake-use-restrictions">{tEditor("fieldUseRestrictions")}</label>
          <input
            id="intake-use-restrictions"
            value={draft.useRestrictions}
            onChange={(event) => set("useRestrictions", event.target.value)}
          />
        </div>

        <div className="admin-field">
          <label htmlFor="intake-serial">{tEditor("unitSerial")}</label>
          <input
            id="intake-serial"
            value={draft.serialNumber}
            maxLength={200}
            onChange={(event) => set("serialNumber", event.target.value)}
          />
        </div>

        <fieldset className="admin-intake-resources">
          <legend>{t("resourcesTitle")}</legend>
          {research.resources.length === 0 ? (
            <p className="admin-intake-hint">{t("noResources")}</p>
          ) : (
            <ul>
              {research.resources.map((resource, index) => (
                <li key={resource.url} className="admin-field is-check">
                  <input
                    id={`intake-resource-${index}`}
                    type="checkbox"
                    checked={draft.resourceUrls.includes(resource.url)}
                    onChange={(event) => toggleResource(resource.url, event.target.checked)}
                  />
                  <label htmlFor={`intake-resource-${index}`}>
                    {t("resourceLabel", { title: resource.title, type: resource.type })}
                  </label>
                  {isWebLink(resource.url) ? (
                    <a href={resource.url} target="_blank" rel="noopener noreferrer">
                      {t("openResource")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      </div>
    </section>
  );
}

/** An add-unit item: the tool it joins, and the one field that matters. */
function UnitProposal({
  target,
  serial,
  onSerial,
  onAdd,
}: {
  target: IntakeToolLink | null;
  serial: string;
  onSerial: (value: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("admin.intake");

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-unit-title">
      <h3 id="intake-unit-title">{t("unitTitle")}</h3>
      {target ? (
        <p>
          {t("unitTarget")} <Link href={`/tools/${target.slug}`}>{target.name}</Link>
          {target.published ? null : <span className="admin-state is-draft">{t("draft")}</span>}
        </p>
      ) : (
        <p className="admin-empty td-empty">{t("unitTargetMissing")}</p>
      )}
      <div className="admin-field">
        <label htmlFor="intake-unit-serial">{t("unitSerial")}</label>
        <input
          id="intake-unit-serial"
          value={serial}
          maxLength={200}
          onChange={(event) => onSerial(event.target.value)}
        />
      </div>
      <div className="admin-editor-actions">
        <button
          type="button"
          className="admin-button is-primary"
          disabled={!target}
          onClick={onAdd}
        >
          {t("addUnit")}
        </button>
      </div>
    </section>
  );
}

/** The photos that came with the item. A private one says so rather than guessing a URL. */
function Photos({ item }: { item: PendingToolView }) {
  const t = useTranslations("admin.intake");

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-photos-title">
      <h3 id="intake-photos-title">{t("photosTitle")}</h3>
      {item.photos.length === 0 ? (
        <p className="admin-intake-hint">{t("noPhotos")}</p>
      ) : (
        <ul className="admin-intake-photos">
          {item.photos.map((photo, index) =>
            photo.url ? (
              <li key={photo.attachmentId} className="admin-thumb is-project">
                <Image
                  src={photo.url}
                  alt={t("photoAlt", { name: item.name, index: index + 1 })}
                  fill
                  sizes="96px"
                  style={{ objectFit: "cover" }}
                  unoptimized
                />
              </li>
            ) : (
              <li key={photo.attachmentId} className="admin-thumb is-project is-empty">
                <span>{t("photoPrivate")}</span>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}

/** Links research found and refused to trust, with the reason for each. */
function DroppedLinks({ research }: { research: ResearchResult }) {
  const t = useTranslations("admin.intake");
  if (research.droppedLinks.length === 0) return null;

  return (
    <section className="admin-intake-panel" aria-labelledby="intake-dropped-title">
      <h3 id="intake-dropped-title">{t("droppedTitle")}</h3>
      <p className="admin-intake-hint">{t("droppedHint")}</p>
      <ul className="admin-intake-dropped">
        {research.droppedLinks.map((line) => (
          // Written in English by link verification: a record, not UI copy.
          <li key={line} lang="en">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How the item left the queue, with where it went. */
function SettledPanel({ outcome }: { outcome: Settled }) {
  const t = useTranslations("admin.intake");
  const tAdmin = useTranslations("admin");

  if (outcome.kind === "discarded") {
    return (
      <section className="admin-intake-done td-panel" role="status">
        <p>{t("discarded")}</p>
        <Link href={ADMIN_INTAKE_PATH}>{t("backToQueue")}</Link>
      </section>
    );
  }

  const message =
    outcome.kind === "unit"
      ? t("unitAdded", { name: outcome.tool.name })
      : outcome.tool.published
        ? t("approvedPublished")
        : t("approvedDraft");

  return (
    <section className="admin-intake-done td-panel" role="status">
      <p>{message}</p>
      <p>
        {/* Drafts render at their slug for anyone holding catalog.view_drafts,
            which every approver does — so the link works either way. */}
        <Link href={`/tools/${outcome.tool.slug}`}>
          {t("openTool", { name: outcome.tool.name })}
        </Link>
      </p>
      {outcome.warning ? (
        <p className="admin-row-status is-warning">{tAdmin(`warnings.${outcome.warning}`)}</p>
      ) : null}
      <Link href={ADMIN_INTAKE_PATH}>{t("backToQueue")}</Link>
    </section>
  );
}

// ── Pure helpers ────────────────────────────────────────────────────

/** An approved or discarded item, as the server says it is. */
function settledFromProps(
  item: PendingToolView,
  createdTool: IntakeToolLink | null,
  isUnit: boolean
): Settled | null {
  if (item.status === "discarded") return { kind: "discarded" };
  if (item.status === "approved" && createdTool) {
    return { kind: isUnit ? "unit" : "approved", tool: createdTool, warning: null };
  }
  return null;
}

/** The proposal as the form's starting point. */
function initialDraft(
  item: PendingToolView,
  research: ResearchResult | null,
  categories: CategoryOption[],
  locations: LocationOption[]
): Draft {
  return {
    name: research?.canonicalName.trim() || item.name,
    description: research ? proposedDescription(research) : "",
    category: research ? proposedCategory(research, categories) : "",
    locationId: matchLocation(item.locationHint, locations),
    materials: (research?.materials ?? []).join(", "),
    ppeRequired: (research?.ppeRequired ?? []).join(", "),
    tags: (research?.tags ?? []).join(", "),
    // Unknown is not "no" — but it is not "yes" either, and the box is in
    // front of the reviewer, who is the one deciding.
    trainingRequired: research?.trainingRequired ?? false,
    useRestrictions: research?.useRestrictions ?? "",
    serialNumber: item.serialNumber ?? "",
    // Every verified link starts ticked; unticking one is the edit.
    resourceUrls: (research?.resources ?? []).map((resource) => resource.url),
  };
}

/**
 * The description, with research's specs appended as a Markdown list.
 *
 * `tools` has no specs column (§4.4), and a spec sheet research read is worth
 * keeping, so it rides in the description where the tool page renders Markdown
 * — as text the reviewer can edit or delete before it is saved.
 */
export function proposedDescription(research: ResearchResult): string {
  const specs = research.specs.map((spec) => `- **${spec.label}:** ${spec.value}`).join("\n");
  return [research.description.trim(), specs].filter(Boolean).join("\n\n");
}

/**
 * The category research matched, if the lab still has it; otherwise research's
 * proposal, to be created at approval; otherwise none.
 */
function proposedCategory(research: ResearchResult, categories: CategoryOption[]): string {
  const existing = research.category.existingId;
  if (existing && categories.some((category) => category.id === existing)) return existing;
  return research.category.name.trim() ? NEW_CATEGORY : "";
}

/** A location whose room or zone is the hint, ignoring case. */
function matchLocation(hint: string | null, locations: LocationOption[]): string {
  const wanted = hint?.trim().toLowerCase();
  if (!wanted) return "";
  const match = locations.find(
    (location) => location.room.toLowerCase() === wanted || location.zone.toLowerCase() === wanted
  );
  return match?.id ?? "";
}

function categoryLabel(name: string, group: string | null): string {
  return group ? `${group} — ${name}` : name;
}

/** "PLA, resin" → ["PLA", "resin"]. Blanks dropped. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The draft as `approvePendingTool` takes it. */
function toFields(draft: Draft, research: ResearchResult): ApprovalFields {
  const isNew = draft.category === NEW_CATEGORY;
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    categoryId: draft.category && !isNew ? draft.category : null,
    newCategory: isNew ? { name: research.category.name, group: research.category.group } : null,
    locationId: draft.locationId || null,
    materials: splitList(draft.materials),
    ppeRequired: splitList(draft.ppeRequired),
    tags: splitList(draft.tags),
    trainingRequired: draft.trainingRequired,
    useRestrictions: draft.useRestrictions.trim() || null,
    serialNumber: draft.serialNumber.trim() || null,
    resourceUrls: draft.resourceUrls,
  };
}
