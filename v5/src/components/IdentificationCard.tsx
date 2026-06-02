"use client";

import type {
  CardAction,
  CardPayload,
  IdentificationCardPayload,
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
