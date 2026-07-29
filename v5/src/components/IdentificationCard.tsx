"use client";

import { useTranslations } from "next-intl";
import {
  confidenceLines,
  type ConfidenceBasisCode,
  type ConfidenceUnknownCode,
} from "../lib/capabilities/confidence";
import type {
  CardAction,
  CardPayload,
  IdentificationCardPayload,
  IntakeConfidenceLevel,
} from "../lib/capabilities/types";

/**
 * Renders an identification card (design spec §4.1, §6.3) emitted by the intake
 * agent as a `data-card` chat part. Presentational only: it shows the proposed
 * (or saved) listing — photo, name, category/location, spec lines, found
 * manuals/videos, the "also creating" taxonomy with `(new)` badges, and the
 * action buttons. Clicking an action calls {@link onAction} with the button's
 * `seedMessage`, which the chat wires back into the existing send path so the
 * agent can resolve it (e.g. `confirm add: <candidateId>`).
 *
 * The card itself owns no chat/network state; all behavior flows up through
 * `onAction`. It switches on the discriminated `kind` so future card types can
 * extend `CardPayload` without changing the call site.
 */
export function IdentificationCard({
  card,
  onAction,
  disabled,
}: {
  card: CardPayload;
  onAction: (seedMessage: string) => void;
  disabled?: boolean;
}) {
  switch (card.kind) {
    case "identification":
      return (
        <Identification card={card} onAction={onAction} disabled={disabled} />
      );
    default:
      // Exhaustiveness guard: a new CardPayload member must add a case above.
      return null;
  }
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ManualIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  );
}

function resourceIcon(type: "Manual" | "Video" | "Other") {
  if (type === "Manual") return <ManualIcon />;
  if (type === "Video") return <VideoIcon />;
  return <LinkIcon />;
}

/**
 * Evidence marker. **No traffic lights** — a red/amber/green badge would import
 * a colour language the app does not otherwise use and would read as an error
 * state rather than a request for help (confidence spec §6). The established
 * convention instead: a solid marker for evidence held, hollow for unknown.
 */
function EvidenceMarker({ held }: { held: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      className="id-card-confidence-marker"
      aria-hidden="true"
    >
      <circle
        cx="6"
        cy="6"
        r="4"
        fill={held ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

const LEVEL_KEYS: Record<IntakeConfidenceLevel, string> = {
  high: "confidenceHigh",
  medium: "confidenceMedium",
  low: "confidenceLow",
};

const BASIS_KEYS: Record<ConfidenceBasisCode, string> = {
  userStatedModel: "basisUserStatedModel",
  modelPlateRead: "basisModelPlateRead",
  manufacturerPage: "basisManufacturerPage",
  manual: "basisManual",
  specsFromSource: "basisSpecsFromSource",
};

const UNKNOWN_KEYS: Record<ConfidenceUnknownCode, string> = {
  model: "unknownModel",
  category: "unknownCategory",
  source: "unknownSource",
  manual: "unknownManual",
  specs: "unknownSpecs",
};

/** Display form of a source link: the bare host, e.g. "bambulab.com". */
function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) links are ever rendered (confidence spec §8). */
function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The confidence strip (confidence spec §6): how sure the agent is, on what
 * basis, what it still does not know, and the pages it actually read. The lines
 * are rebuilt from the card's structured `evidence` so they are localized like
 * every other string — `confidence.basis` is the English, model-facing copy.
 */
function ConfidenceStrip({ card }: { card: IdentificationCardPayload }) {
  const t = useTranslations("intake");
  const confidence = card.confidence;
  const evidence = card.evidence;
  if (!confidence || !evidence) return null;

  const lines = confidenceLines(evidence);
  const sources = (card.sourceUrls || []).filter(isWebLink);

  // The strip reuses the "also creating" list styles so it is presentable
  // before any `.id-card-confidence*` rules exist in globals.css (a file this
  // change does not own); the semantic classes ride alongside for that pass.
  return (
    <section
      className={`id-card-also id-card-confidence id-card-confidence-${confidence.level}`}
    >
      <p className="id-card-also-label id-card-confidence-level">
        {t(LEVEL_KEYS[confidence.level])}
      </p>
      <ul className="id-card-also-list id-card-confidence-lines">
        {lines.basis.map((line) => (
          <li
            key={`basis-${line.code}`}
            className="id-card-also-row id-card-confidence-line"
          >
            <EvidenceMarker held />
            <span className="sr-only">{t("confidenceHeldAria")}</span>
            <span>{t(BASIS_KEYS[line.code], line.values)}</span>
          </li>
        ))}
        {lines.unknowns.map((line) => (
          <li
            key={`unknown-${line.code}`}
            className="id-card-also-row id-card-confidence-line id-card-confidence-line-unknown"
          >
            <EvidenceMarker held={false} />
            <span className="sr-only">{t("confidenceUnknownAria")}</span>
            <span>{t(UNKNOWN_KEYS[line.code])}</span>
          </li>
        ))}
      </ul>
      {sources.length > 0 ? (
        <p className="id-card-confidence-sources">
          <span className="id-card-confidence-sources-label">
            {t("confidenceSources")}:{" "}
          </span>
          {sources.map((url, i) => (
            <span key={url}>
              {i > 0 ? <span aria-hidden="true"> · </span> : null}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="id-card-draft-link id-card-confidence-source"
              >
                {sourceLabel(url)}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

function actionClass(variant: CardAction["variant"]): string {
  if (variant === "primary") return "id-card-action id-card-action-primary";
  if (variant === "danger") return "id-card-action id-card-action-danger";
  return "id-card-action id-card-action-secondary";
}

function Identification({
  card,
  onAction,
  disabled,
}: {
  card: IdentificationCardPayload;
  onAction: (seedMessage: string) => void;
  disabled?: boolean;
}) {
  const isSuccess = card.state === "success";
  const isDuplicate = card.state === "duplicate";
  const isError = card.state === "error";
  const photo = card.photoUrls[0];

  return (
    <article
      className={`id-card id-card-${card.state}`}
      aria-label={card.name}
    >
      {isSuccess ? (
        <p className="id-card-banner id-card-banner-success">
          <span className="id-card-banner-icon">
            <CheckIcon />
          </span>
          Saved as a draft — staff will publish it.
        </p>
      ) : null}
      {isError ? (
        <p className="id-card-banner id-card-banner-error">
          Couldn’t be saved — see the details below.
        </p>
      ) : null}
      {isDuplicate && card.duplicateOf ? (
        <p className="id-card-banner id-card-banner-duplicate">
          Already in catalog: {card.duplicateOf.name}
        </p>
      ) : null}

      <div className="id-card-head">
        {photo ? (
          <div className="id-card-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt={card.name} />
            {card.photoUrls.length > 1 ? (
              <span className="id-card-photo-count">
                +{card.photoUrls.length - 1}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="id-card-headings">
          <h3 className="id-card-name">{card.name}</h3>
          {card.category ? (
            <p className="id-card-meta">{card.category}</p>
          ) : null}
          {card.location ? (
            <p className="id-card-meta">{card.location}</p>
          ) : null}
        </div>
      </div>

      {card.specLines.length > 0 ? (
        <dl className="id-card-specs">
          {card.specLines.map((line, i) => (
            <div key={`${line.label}-${i}`} className="id-card-spec">
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {card.foundResources.length > 0 ? (
        <ul className="id-card-resources">
          {card.foundResources.map((res, i) => (
            <li key={`${res.url}-${i}`}>
              <a
                href={res.url}
                target="_blank"
                rel="noopener noreferrer"
                className="id-card-resource"
              >
                <span className="id-card-resource-icon">
                  {resourceIcon(res.type)}
                </span>
                <span className="id-card-resource-title">{res.title}</span>
                <span className="id-card-resource-type">{res.type}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {card.alsoCreating.length > 0 ? (
        <div className="id-card-also">
          <p className="id-card-also-label">Also creating</p>
          <ul className="id-card-also-list">
            {card.alsoCreating.map((row, i) => (
              <li key={`${row.entity}-${i}`} className="id-card-also-row">
                <span>{row.label}</span>
                {row.isNew ? (
                  <span className="id-card-badge-new">(new)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfidenceStrip card={card} />

      {isSuccess && card.draftUrl ? (
        <a
          href={card.draftUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="id-card-draft-link"
        >
          Open draft in Notion
        </a>
      ) : null}

      {card.actions.length > 0 ? (
        <div className="id-card-actions">
          {card.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={actionClass(action.variant)}
              disabled={disabled}
              onClick={() => onAction(action.seedMessage)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
