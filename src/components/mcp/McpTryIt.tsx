"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { McpToolField, McpToolSummary } from "../../lib/capabilities/mcp-catalog";
import type { TryItArguments, TryItResult } from "../../lib/mcp/try-it";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RowStatus } from "../admin/RowStatus";
import { Field } from "../system/Field";
import { PageSection } from "../system/PublicPage";

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
    <PageSection
      id="mcp-try-heading"
      title={t("heading")}
      lede={
        <>
          <p>{t("lede")}</p>
          <p className="mt-1">{t("writesNote")}</p>
        </>
      }
    >
      <form
        className="flex w-full max-w-[640px] min-w-0 flex-col gap-4 border border-border bg-card p-4"
        onSubmit={handleRun}
        aria-labelledby="mcp-try-heading"
      >
        <Field id={`${formId}-tool`} label={t("toolLabel")} hint={tool.description}>
          <NativeSelect
            id={`${formId}-tool`}
            className="w-full"
            value={tool.name}
            onChange={(event) => chooseTool(event.target.value)}
          >
            {tools.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

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

        <div>
          <Button type="submit" variant="default" disabled={busy}>
            {busy ? t("running") : t("run", { tool: tool.name })}
          </Button>
        </div>
      </form>

      <div aria-live="polite">{outcome ? <OutcomeView outcome={outcome} /> : null}</div>
    </PageSection>
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
  const describedBy = field.description ? `${id}-hint` : undefined;

  if (field.type === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={value === true}
            aria-describedby={describedBy}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <label htmlFor={id} className="font-mono text-sm">
            {field.name}
          </label>
        </div>
        {field.description ? (
          <div id={describedBy} className="text-xs text-muted-foreground">
            {field.description}
          </div>
        ) : null}
      </div>
    );
  }

  if (field.enumValues) {
    return (
      <Field id={id} label={field.name} hint={field.description}>
        <NativeSelect
          id={id}
          className="w-full"
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
        </NativeSelect>
      </Field>
    );
  }

  const numeric = field.type === "number" || field.type === "integer";
  return (
    <Field id={id} label={field.name} hint={field.description}>
      <Input
        id={id}
        type={numeric ? "number" : "text"}
        step={field.type === "integer" ? 1 : undefined}
        value={typeof value === "string" ? value : ""}
        required={field.required}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
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
    return (
      <RowStatus tone="bad" as="p" className="text-sm">
        {t(`errors.${outcome.code}`)}
      </RowStatus>
    );
  }
  const { result, isError } = toolResult(outcome.response);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="font-mono text-label uppercase tabular-nums">{t("summary", { status: outcome.status, ms: outcome.durationMs })}</p>
      {outcome.status === 429 ? (
        <RowStatus tone="bad" as="p" className="text-sm">
          {t("rateLimited")}
        </RowStatus>
      ) : null}
      {isError ? (
        <RowStatus tone="warn" as="p" className="text-sm">
          {t("toolError")}
        </RowStatus>
      ) : null}
      {result === undefined ? null : (
        <details open>
          <summary className="cursor-pointer font-mono text-label uppercase">{t("resultHeading")}</summary>
          <pre className={JSON_BLOCK}>{pretty(result)}</pre>
        </details>
      )}
      <details>
        <summary className="cursor-pointer font-mono text-label uppercase">{t("rawHeading")}</summary>
        <pre className={JSON_BLOCK}>{pretty(outcome.response)}</pre>
      </details>
    </div>
  );
}

const JSON_BLOCK = "mt-2 max-h-[420px] overflow-auto border border-border bg-card px-3 py-2.5 font-mono text-table whitespace-pre";

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
