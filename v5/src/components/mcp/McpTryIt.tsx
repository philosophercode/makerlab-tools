"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { McpToolField, McpToolSummary } from "../../lib/capabilities/mcp-catalog";
import type { TryItArguments, TryItResult } from "../../lib/mcp/try-it";

/**
 * "Try it" on `/mcp` (MCP access spec, amendment 2026-09-25): a form built from
 * a public read's input summary — text and number inputs, enums as selects —
 * that runs the tool through the MCP handler and shows what came back.
 *
 * The action arrives as a prop (the `TokenManager` idiom), so `next/headers`
 * and the handler stay out of the client graph. The list of tools is only
 * what to offer: the action checks the tool again and always runs it as an
 * anonymous caller.
 */

export interface McpTryItProps {
  /** The runnable tools: public reads, as `tryItToolNames` derives them. */
  tools: McpToolSummary[];
  runAction: (input: { tool: string; arguments: TryItArguments }) => Promise<TryItResult>;
}

type Values = Record<string, string | boolean>;

type Outcome =
  | { kind: "ran"; status: number; durationMs: number; response: unknown }
  | { kind: "refused"; code: "not_runnable" | "invalid_input" | "failed" };

export function McpTryIt({ tools, runAction }: McpTryItProps) {
  const t = useTranslations("mcpPage.tryIt");
  const formId = useId();
  const [toolName, setToolName] = useState(tools[0]?.name ?? "");
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) return null;

  function chooseTool(name: string) {
    setToolName(name);
    setValues({});
    setOutcome(null);
  }

  async function handleRun(event: React.FormEvent) {
    event.preventDefault();
    if (!tool) return;
    setBusy(true);
    try {
      const result = await runAction({ tool: tool.name, arguments: toArguments(tool.fields, values) });
      setOutcome(
        result.ok
          ? { kind: "ran", status: result.status, durationMs: result.durationMs, response: result.response }
          : { kind: "refused", code: result.error }
      );
    } catch {
      setOutcome({ kind: "refused", code: "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-section" aria-labelledby="mcp-try-heading">
      <h2 id="mcp-try-heading">{t("heading")}</h2>
      <p>{t("lede")}</p>
      <p className="account-field-hint">{t("writesNote")}</p>

      <form className="account-form mcp-try-form" onSubmit={handleRun} aria-labelledby="mcp-try-heading">
        <div className="account-field">
          <label htmlFor={`${formId}-tool`}>{t("toolLabel")}</label>
          <select id={`${formId}-tool`} value={tool.name} onChange={(event) => chooseTool(event.target.value)}>
            {tools.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
          <p className="account-field-hint">{tool.description}</p>
        </div>

        {tool.fields.map((field) => (
          <FieldInput
            key={`${tool.name}:${field.name}`}
            id={`${formId}-${tool.name}-${field.name}`}
            field={field}
            value={values[field.name]}
            anyLabel={t("any")}
            onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
          />
        ))}

        <div className="account-actions">
          <button type="submit" className="account-button is-primary" disabled={busy}>
            {busy ? t("running") : t("run", { tool: tool.name })}
          </button>
        </div>
      </form>

      <div aria-live="polite">{outcome ? <OutcomeView outcome={outcome} /> : null}</div>
    </section>
  );
}

function FieldInput({
  id,
  field,
  value,
  anyLabel,
  onChange,
}: {
  id: string;
  field: McpToolField;
  value: string | boolean | undefined;
  anyLabel: string;
  onChange: (value: string | boolean) => void;
}) {
  const hintId = `${id}-hint`;
  const hint = field.description ? (
    <p id={hintId} className="account-field-hint">
      {field.description}
    </p>
  ) : null;
  const describedBy = field.description ? hintId : undefined;

  if (field.type === "boolean") {
    return (
      <div className="account-field">
        <label className="account-check" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{field.name}</span>
        </label>
        {hint}
      </div>
    );
  }

  if (field.enumValues) {
    return (
      <div className="account-field">
        <label htmlFor={id}>{field.name}</label>
        <select
          id={id}
          value={typeof value === "string" ? value : field.required ? field.enumValues[0] : ""}
          required={field.required}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.required ? null : <option value="">{anyLabel}</option>}
          {field.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {hint}
      </div>
    );
  }

  const numeric = field.type === "number" || field.type === "integer";
  return (
    <div className="account-field">
      <label htmlFor={id}>{field.name}</label>
      <input
        id={id}
        type={numeric ? "number" : "text"}
        step={field.type === "integer" ? 1 : undefined}
        value={typeof value === "string" ? value : ""}
        required={field.required}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint}
    </div>
  );
}

/** The form's values as the tool's arguments: empty optional fields left out, numbers as numbers. */
export function toArguments(fields: McpToolField[], values: Values): TryItArguments {
  const out: TryItArguments = {};
  for (const field of fields) {
    const value = values[field.name] ?? (field.required && field.enumValues ? field.enumValues[0] : undefined);
    if (value === undefined || value === "") continue;
    if (typeof value === "boolean") {
      out[field.name] = value;
    } else if (field.type === "number" || field.type === "integer") {
      const number = Number(value);
      if (Number.isFinite(number)) out[field.name] = number;
    } else {
      out[field.name] = value;
    }
  }
  return out;
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  const t = useTranslations("mcpPage.tryIt");
  if (outcome.kind === "refused") {
    return <p className="account-status is-error">{t(`errors.${outcome.code}`)}</p>;
  }
  const { result, isError } = toolResult(outcome.response);
  return (
    <div className="mcp-try-result">
      <p className="account-status">{t("summary", { status: outcome.status, ms: outcome.durationMs })}</p>
      {outcome.status === 429 ? <p className="account-status is-error">{t("rateLimited")}</p> : null}
      {isError ? <p className="account-status is-warning">{t("toolError")}</p> : null}
      {result === undefined ? null : (
        <details className="mcp-json" open>
          <summary>{t("resultHeading")}</summary>
          <pre className="account-code">{pretty(result)}</pre>
        </details>
      )}
      <details className="mcp-json">
        <summary>{t("rawHeading")}</summary>
        <pre className="account-code">{pretty(outcome.response)}</pre>
      </details>
    </div>
  );
}

/** The tool's own answer from a `tools/call` response: its text parts, parsed when they are JSON. */
function toolResult(response: unknown): { result: unknown; isError: boolean } {
  const body = response as { result?: { content?: { type?: string; text?: string }[]; isError?: boolean } } | null;
  const content = body?.result?.content;
  if (!Array.isArray(content)) return { result: undefined, isError: false };
  const texts = content.filter((part) => part.type === "text").map((part) => part.text ?? "");
  const parsed = texts.map((text) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  });
  return { result: parsed.length === 1 ? parsed[0] : parsed, isError: body?.result?.isError === true };
}

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
