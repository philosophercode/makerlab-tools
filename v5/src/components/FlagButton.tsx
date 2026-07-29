"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "Report a correction" — a quiet text control in the tool detail footer that
 * opens a short modal form (design spec 2026-07-29 §6). Technical-schematic:
 * text only, no icon-only control, no colour until focus/hover, square corners
 * (the global reset forces `border-radius: 0`).
 *
 * The confirmation replaces the form in place rather than firing a toast —
 * toasts vanish before they are read. On failure the typed input is kept.
 *
 * This is a client component, so it cannot import the server-only `flags`
 * capability; `FIELD_OPTIONS` mirrors `FLAG_FIELDS` there and `FlagButton.test.tsx`
 * asserts the two stay in step.
 */

const FIELD_OPTIONS = [
  "description",
  "image",
  "name",
  "category",
  "location",
  "materials",
  "safety_info",
] as const;

type FieldOption = (typeof FIELD_OPTIONS)[number];

/** Mirrors MAX_FLAG_TEXT in lib/capabilities/flags.ts (spec §8). */
const MAX_TEXT = 2_000;
const MAX_REPORTER = 200;

/** Error `code`s from `/api/flags` mapped to the message key shown to students. */
const ERROR_MESSAGE_KEY: Record<string, "errorInvalid" | "errorRateLimited" | "errorFailed"> = {
  invalid_input: "errorInvalid",
  unknown_tool: "errorInvalid",
  rate_limited: "errorRateLimited",
  not_configured: "errorFailed",
  write_failed: "errorFailed",
};

interface FlagButtonProps {
  /** Notion page id of the tool being reported. */
  toolId: string;
  /** Pre-selected field, when the control is opened from a specific one. */
  field?: FieldOption;
}

export function FlagButton({ toolId, field: initialField = "description" }: FlagButtonProps) {
  const t = useTranslations("flag");
  const headingId = useId();

  const [open, setOpen] = useState(false);
  const [field, setField] = useState<FieldOption>(initialField);
  const [description, setDescription] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [reporter, setReporter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<"errorInvalid" | "errorRateLimited" | "errorFailed" | null>(null);
  const [sent, setSent] = useState(false);

  // Esc closes, matching the rest of the app's overlays.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    // Reset only after a successful report; a failed one keeps what was typed.
    if (sent) {
      setSent(false);
      setField(initialField);
      setDescription("");
      setSuggestion("");
      setReporter("");
    }
    setErrorKey(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!description.trim() || submitting) return;

    setErrorKey(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_id: toolId,
          field_flagged: field,
          issue_description: description.trim(),
          suggested_fix: suggestion.trim() || undefined,
          reporter: reporter.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { code?: string } | null;
        setErrorKey(ERROR_MESSAGE_KEY[data?.code || ""] || "errorFailed");
        return;
      }

      setSent(true);
    } catch {
      setErrorKey("errorFailed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <style href="makerlab-flag-button" precedence="medium">
        {FLAG_STYLES}
      </style>

      <div className="flag-footer">
        <button type="button" className="flag-trigger" onClick={() => setOpen(true)}>
          {t("trigger")}
        </button>
      </div>

      {open ? (
        <div
          className="flag-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="flag-modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
            {sent ? (
              <div className="flag-sent">
                <p className="flag-eyebrow">{t("eyebrow")}</p>
                <h2 id={headingId}>{t("sentTitle")}</h2>
                <p className="flag-note">{t("sentBody")}</p>
                <div className="flag-actions">
                  <button type="button" className="flag-submit" onClick={close}>
                    {t("close")}
                  </button>
                </div>
              </div>
            ) : (
              <form className="flag-form" onSubmit={handleSubmit}>
                <p className="flag-eyebrow">{t("eyebrow")}</p>
                <h2 id={headingId}>{t("title")}</h2>
                <p className="flag-note">{t("lede")}</p>

                <label className="flag-field">
                  <span>{t("fieldLabel")}</span>
                  <select
                    value={field}
                    onChange={(event) => setField(event.target.value as FieldOption)}
                  >
                    {FIELD_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {t(`fields.${option}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flag-field">
                  <span>{t("descriptionLabel")}</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                    maxLength={MAX_TEXT}
                    rows={4}
                    required
                  />
                </label>

                <label className="flag-field">
                  <span>{t("suggestionLabel")}</span>
                  <textarea
                    value={suggestion}
                    onChange={(event) => setSuggestion(event.target.value)}
                    maxLength={MAX_TEXT}
                    rows={2}
                  />
                </label>

                <label className="flag-field">
                  <span>{t("nameLabel")}</span>
                  <input
                    type="text"
                    value={reporter}
                    onChange={(event) => setReporter(event.target.value)}
                    maxLength={MAX_REPORTER}
                  />
                </label>

                {errorKey ? (
                  <p className="flag-error" role="alert">
                    {t(errorKey)}
                  </p>
                ) : null}

                <div className="flag-actions">
                  <button
                    type="submit"
                    className="flag-submit"
                    disabled={!description.trim() || submitting}
                  >
                    {submitting ? t("submitting") : t("submit")}
                  </button>
                  <button type="button" className="flag-cancel" onClick={close}>
                    {t("cancel")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Scoped styles, hoisted by React 19 (`precedence`) so they dedupe across
 * renders. They live here rather than in `globals.css` only because this
 * component was added under separate file ownership — folding them into the
 * stylesheet later is a no-op. Everything reads the global theme tokens, so
 * light/dark both work; the global reset already squares the corners.
 */
const FLAG_STYLES = `
.flag-footer {
  width: min(1220px, calc(100vw - 56px));
  margin: 0 auto 40px;
  display: flex;
  justify-content: flex-start;
}
.flag-trigger {
  border: none;
  background: none;
  padding: 4px 0;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--on-surface-muted);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.flag-trigger:hover,
.flag-trigger:focus-visible {
  color: var(--on-surface);
}
.flag-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.55);
}
.flag-modal {
  width: min(520px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--outline);
  background: var(--surface-container);
  color: var(--on-surface);
}
.flag-form,
.flag-sent {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.flag-modal h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
}
.flag-eyebrow {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--on-surface-muted);
}
.flag-note {
  margin: 0;
  font-size: 14px;
  color: var(--on-surface-muted);
}
.flag-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.flag-field > span {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--on-surface-muted);
}
.flag-field input,
.flag-field select,
.flag-field textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--outline);
  background: var(--background);
  color: var(--on-surface);
  font-family: var(--font-body);
  font-size: 14px;
}
.flag-field textarea {
  resize: vertical;
}
.flag-field input:focus,
.flag-field select:focus,
.flag-field textarea:focus {
  outline: none;
  border-color: var(--primary);
}
.flag-error {
  margin: 0;
  font-size: 14px;
  color: var(--secondary);
}
.flag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.flag-submit,
.flag-cancel {
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--outline);
  background: none;
  color: var(--on-surface);
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}
.flag-submit {
  border-color: var(--on-surface);
}
.flag-submit:disabled {
  border-color: var(--outline);
  color: var(--on-surface-muted);
  cursor: not-allowed;
}
`;
