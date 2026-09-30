"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { TaxonomyActions } from "../../app/admin/taxonomy/action-result";
import { EmptyState } from "../system/EmptyState";
import { Field, hintId } from "../system/Field";
import { InlineTextEditor } from "../system/InlineTextEditor";
import { RowStatus } from "./RowStatus";
import {
  buildTaxonomyTree,
  categoryChoices,
  categoryPathLabel,
  type TaxonomyCategoryRow,
  type TaxonomyNodeView,
  type TaxonomyToolRow,
} from "./taxonomy-tree";
import { useHydrated } from "./use-hydrated";
import { useRowAction, type RowActionResult } from "./use-row-action";

/**
 * `/admin/taxonomy`'s island (taxonomy v2 spec §5.3): the proposals queue on
 * top — the work waiting — then the tree with counts and descriptions, each
 * category renamable, re-describable, mergeable and retirable, and its tools
 * movable; retired categories folded at the end; and **Propose a category**.
 *
 * Every control saves on the click through a server action passed down as a
 * prop, which re-checks its own permission (`taxonomy.manage`, or
 * `tools.edit` to propose or move a tool). Merge is the one irreversible
 * control: it asks for a second click that names both categories. Never a
 * modal (UI system spec §6); outcomes are `RowStatus` lines, never toasts.
 */

export interface TaxonomyProposalRow {
  id: string;
  kind: "new_category" | "review_category";
  name: string;
  parentId: string | null;
  description: string | null;
  reason: string | null;
  source: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectName: string | null;
  flag: string | null;
  nearestExistingId: string | null;
  status: string;
  resultingCategoryId: string | null;
}

export interface TaxonomyBoardProps {
  categories: TaxonomyCategoryRow[];
  tools: TaxonomyToolRow[];
  proposals: TaxonomyProposalRow[];
  actions: TaxonomyActions;
}

export function TaxonomyBoard({ categories, tools, proposals, actions }: TaxonomyBoardProps) {
  const t = useTranslations("admin.taxonomy");
  const tree = useMemo(() => buildTaxonomyTree(categories, tools), [categories, tools]);
  const choices = useMemo(() => categoryChoices(tree), [tree]);
  const byId = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const decided = proposals.filter((proposal) => proposal.status !== "pending");
  const parents = tree.roots.map((root) => root.category);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="taxonomy-proposals" className="flex flex-col gap-3">
        <h3 id="taxonomy-proposals" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
          {t("proposalsHeading", { count: pending.length })}
        </h3>
        {pending.length === 0 ? (
          <EmptyState>{t("proposalsEmpty")}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((proposal) => (
              <li key={proposal.id}>
                <ProposalCard proposal={proposal} byId={byId} choices={choices} decide={actions.decide} />
              </li>
            ))}
          </ul>
        )}
        {decided.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("decidedHeading", { count: decided.length })}</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {decided.map((proposal) => (
                <li key={proposal.id} className="text-muted-foreground">
                  {t("decidedLine", {
                    name: proposal.name,
                    status: t(`status.${proposal.status}`),
                    into: proposal.resultingCategoryId ? (byId.get(proposal.resultingCategoryId)?.name ?? "—") : "—",
                  })}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <ProposeCategoryForm parents={parents} propose={actions.propose} />
      </section>

      <section aria-labelledby="taxonomy-tree" className="flex flex-col gap-3">
        <h3 id="taxonomy-tree" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
          {t("treeHeading")}
        </h3>
        {tree.roots.length === 0 ? <EmptyState>{t("treeEmpty")}</EmptyState> : null}
        <ul className="flex flex-col gap-4">
          {tree.roots.map((root) => (
            <li key={root.category.id} className="border border-rule p-3">
              <CategoryNode node={root} level={1} choices={choices} actions={actions} />
              {root.children.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-3 border-s border-rule ps-4">
                  {root.children.map((child) => (
                    <li key={child.category.id}>
                      <CategoryNode node={child} level={2} choices={choices} actions={actions} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {tree.legacy.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">{t("legacyHeading", { count: tree.legacy.length })}</h4>
            <p className="text-xs text-muted-foreground">{t("legacyHint")}</p>
            <ul className="flex flex-col gap-3">
              {tree.legacy.map((node) => (
                <li key={node.category.id} className="border border-dashed border-rule p-3">
                  <CategoryNode node={node} level={2} choices={choices} actions={actions} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {tree.uncategorized.length > 0 ? (
          <p className="text-sm text-muted-foreground">{t("uncategorized", { count: tree.uncategorized.length, names: tree.uncategorized.map((tool) => tool.name).join(", ") })}</p>
        ) : null}
        {tree.retired.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("retiredHeading", { count: tree.retired.length })}</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {tree.retired.map((category) => (
                <li key={category.id}>
                  <RetiredRow category={category} label={categoryPathLabel(category, byId)} mergedInto={category.mergedIntoId ? byId.get(category.mergedIntoId)?.name ?? null : null} setRetired={actions.setRetired} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

// ── One proposal ────────────────────────────────────────────────────

function ProposalCard({
  proposal,
  byId,
  choices,
  decide,
}: {
  proposal: TaxonomyProposalRow;
  byId: ReadonlyMap<string, TaxonomyCategoryRow>;
  choices: { id: string; label: string }[];
  decide: TaxonomyActions["decide"];
}) {
  const t = useTranslations("admin.taxonomy");
  const hydrated = useHydrated();
  const selectId = useId();
  const row = useRowAction<string>("pending");
  const [target, setTarget] = useState(proposal.nearestExistingId ?? "");
  const parent = proposal.parentId ? byId.get(proposal.parentId) : undefined;
  const nearest = proposal.nearestExistingId ? byId.get(proposal.nearestExistingId) : undefined;
  const isReview = proposal.kind === "review_category";
  const done = row.value !== "pending";
  const run = (decision: "accept" | "merge" | "reject") =>
    void row.run(decision, () => decide({ proposalId: proposal.id, decision, targetCategoryId: decision === "merge" ? target || null : null }) as Promise<RowActionResult>);

  return (
    <article className="flex flex-col gap-2 border border-rule p-3" aria-label={t("proposalFor", { name: proposal.name })}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">{parent ? `${parent.name} › ${proposal.name}` : proposal.name}</strong>
        <Badge variant={isReview ? "outline" : "accent"}>{isReview ? t(`flag.${proposal.flag ?? "review"}`) : t("kindNew")}</Badge>
        <Badge variant="outline">{t(`source.${proposal.source}`)}</Badge>
      </div>
      {proposal.description ? <p className="text-sm">{proposal.description}</p> : null}
      {proposal.reason ? <p className="text-xs text-muted-foreground">{t("reason", { reason: proposal.reason })}</p> : null}
      {proposal.subjectName ? (
        <p className="text-xs text-muted-foreground">{t(isReview ? "subjectCategory" : "subjectTool", { name: proposal.subjectName })}</p>
      ) : null}
      {nearest && !isReview ? <p className="text-xs text-muted-foreground">{t("nearest", { name: nearest.name })}</p> : null}
      {done ? (
        <p className="text-sm">{t(`decided.${row.value}`)}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2" role="group" aria-label={t("decideFor", { name: proposal.name })}>
          {!isReview ? (
            <Button size="sm" variant="default" disabled={!hydrated || row.pending} onClick={() => run("accept")}>
              {t("accept")}
            </Button>
          ) : null}
          <label className="sr-only" htmlFor={selectId}>
            {t("mergeTargetFor", { name: proposal.name })}
          </label>
          <NativeSelect id={selectId} size="sm" value={target} onChange={(event) => setTarget(event.target.value)} disabled={!hydrated || row.pending}>
            <option value="">{t("chooseCategory")}</option>
            {choices
              .filter((choice) => !(isReview && choice.id === proposal.subjectId))
              .map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
          </NativeSelect>
          <Button size="sm" disabled={!hydrated || row.pending || !target} onClick={() => run("merge")}>
            {isReview ? t("mergeFlagged") : t("mergeInto")}
          </Button>
          <Button size="sm" variant="ghost" disabled={!hydrated || row.pending} onClick={() => run("reject")}>
            {isReview ? t("dismiss") : t("reject")}
          </Button>
        </div>
      )}
      <RowStatus pending={row.pending} saved={false} error={row.error} warning={row.warning} />
    </article>
  );
}

// ── One category ────────────────────────────────────────────────────

function CategoryNode({
  node,
  level,
  choices,
  actions,
}: {
  node: TaxonomyNodeView;
  level: 1 | 2;
  choices: { id: string; label: string }[];
  actions: TaxonomyActions;
}) {
  const t = useTranslations("admin.taxonomy");
  const tErrors = useTranslations("admin");
  const hydrated = useHydrated();
  const mergeId = useId();
  const { category } = node;
  const retire = useRowAction<boolean>(false);
  const merge = useRowAction<string>("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const Heading = level === 1 ? "h4" : "h5";
  const describe = (code: { error: string } | { warning: string }) =>
    "error" in code ? tErrors(`errors.${code.error}`) : tErrors(`warnings.${code.warning}`);
  const targetLabel = choices.find((choice) => choice.id === mergeTarget)?.label ?? "";
  const canRetire = node.total === 0 && node.children.length === 0;

  return (
    <div className="flex flex-col gap-1.5" data-category={category.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <Heading className={level === 1 ? "text-base font-semibold" : "text-sm font-medium"}>
          <InlineTextEditor
            value={category.name}
            display={(stored) => stored}
            editLabel={t("renameLabel", { name: category.name })}
            editTooltip={t("renameTooltip")}
            inputLabel={t("nameLabel")}
            maxLength={60}
            save={async (draft) => {
              const result = await actions.edit({ categoryId: category.id, name: draft });
              return result.ok ? { ok: true, value: draft.trim(), warning: result.warning } : { ok: false, error: result.error };
            }}
            describe={describe}
          />
        </Heading>
        <code className="font-mono text-micro text-muted-foreground">{category.slug}</code>
        <Badge variant="secondary">{t("toolCount", { count: node.total })}</Badge>
        {category.galleryHidden ? <Badge variant="outline">{t("hiddenFromGallery")}</Badge> : null}
        {category.group ? <Badge variant="outline">{t("legacyGroup", { group: category.group })}</Badge> : null}
      </div>
      <InlineTextEditor
        value={category.description}
        display={(stored) => <span className="text-sm text-muted-foreground">{stored || t("noDescription")}</span>}
        editLabel={t("describeLabel", { name: category.name })}
        editTooltip={t("describeTooltip")}
        inputLabel={t("descriptionLabel")}
        hint={t("descriptionHint")}
        maxLength={600}
        save={async (draft) => {
          const result = await actions.edit({ categoryId: category.id, description: draft });
          return result.ok ? { ok: true, value: draft.trim() || null, warning: result.warning } : { ok: false, error: result.error };
        }}
        describe={describe}
      />

      {node.tools.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("toolsIn", { count: node.tools.length })}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {node.tools.map((tool) => (
              <li key={tool.id}>
                <ToolMoveRow tool={tool} choices={choices} recategorize={actions.recategorize} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("manageFor", { name: category.name })}>
        {node.children.length === 0 ? (
          <>
            <label className="sr-only" htmlFor={mergeId}>
              {t("mergeTargetFor", { name: category.name })}
            </label>
            <NativeSelect
              id={mergeId}
              size="sm"
              value={mergeTarget}
              disabled={!hydrated || merge.pending}
              onChange={(event) => {
                setMergeTarget(event.target.value);
                setConfirming(false);
              }}
            >
              <option value="">{t("mergeIntoPlaceholder")}</option>
              {choices
                .filter((choice) => choice.id !== category.id && choice.id !== category.parentId)
                .map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
            </NativeSelect>
            {confirming ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={!hydrated || merge.pending}
                onClick={() => void merge.run(mergeTarget, () => actions.merge({ fromId: category.id, intoId: mergeTarget }) as Promise<RowActionResult>).then(() => setConfirming(false))}
              >
                {t("mergeConfirm", { from: category.name, into: targetLabel })}
              </Button>
            ) : (
              <Button size="sm" disabled={!hydrated || !mergeTarget || merge.pending} onClick={() => setConfirming(true)}>
                {t("merge")}
              </Button>
            )}
          </>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={!hydrated || retire.pending || !canRetire}
          title={canRetire ? undefined : t("retireNeedsEmpty")}
          onClick={() => void retire.run(true, () => actions.setRetired({ categoryId: category.id, retired: true }) as Promise<RowActionResult>)}
        >
          {t("retire")}
        </Button>
      </div>
      <RowStatus pending={merge.pending || retire.pending} saved={merge.saved || retire.saved} error={merge.error ?? retire.error} warning={merge.warning ?? retire.warning} />
    </div>
  );
}

function ToolMoveRow({
  tool,
  choices,
  recategorize,
}: {
  tool: TaxonomyToolRow;
  choices: { id: string; label: string }[];
  recategorize: TaxonomyActions["recategorize"];
}) {
  const t = useTranslations("admin.taxonomy");
  const hydrated = useHydrated();
  const id = useId();
  const row = useRowAction<string>(tool.categoryId ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a className="text-sm underline-offset-4 hover:underline" href={`/tools/${tool.slug}`}>
        {tool.name}
      </a>
      <label className="sr-only" htmlFor={id}>
        {t("moveLabel", { name: tool.name })}
      </label>
      <NativeSelect
        id={id}
        size="sm"
        value={row.value}
        disabled={!hydrated || row.pending}
        onChange={(event) => {
          const next = event.target.value;
          if (next) void row.run(next, () => recategorize({ toolId: tool.id, expectedRevision: tool.revision, categoryId: next }) as Promise<RowActionResult>);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </NativeSelect>
      <RowStatus pending={row.pending} saved={row.saved} error={row.error} warning={null} />
    </div>
  );
}

function RetiredRow({
  category,
  label,
  mergedInto,
  setRetired,
}: {
  category: TaxonomyCategoryRow;
  label: string;
  mergedInto: string | null;
  setRetired: TaxonomyActions["setRetired"];
}) {
  const t = useTranslations("admin.taxonomy");
  const hydrated = useHydrated();
  const row = useRowAction<boolean>(true);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{label}</span>
      <code className="font-mono text-micro text-muted-foreground">{category.slug}</code>
      {mergedInto ? <span className="text-xs text-muted-foreground">{t("mergedInto", { name: mergedInto })}</span> : null}
      {row.value ? (
        <Button size="xs" disabled={!hydrated || row.pending} onClick={() => void row.run(false, () => setRetired({ categoryId: category.id, retired: false }) as Promise<RowActionResult>)}>
          {t("restore")}
        </Button>
      ) : null}
      <RowStatus pending={row.pending} saved={row.saved} error={row.error} warning={row.warning} />
    </div>
  );
}

// ── Propose a category ──────────────────────────────────────────────

function ProposeCategoryForm({ parents, propose }: { parents: TaxonomyCategoryRow[]; propose: TaxonomyActions["propose"] }) {
  const t = useTranslations("admin.taxonomy");
  const hydrated = useHydrated();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: true; name: string } | { ok: false; error: string } | null>(null);

  if (!open) {
    return (
      <div>
        <Button size="sm" disabled={!hydrated} onClick={() => setOpen(true)}>
          {t("proposeOpen")}
        </Button>
        {outcome?.ok ? <RowStatus tone="ok">{t("proposed", { name: outcome.name })}</RowStatus> : null}
      </div>
    );
  }

  const submit = async () => {
    setPending(true);
    setOutcome(null);
    try {
      const result = await propose({ name, parentId: parentId || null, description: description || null, reason: reason || null });
      if (result.ok) {
        setOutcome({ ok: true, name: name.trim() });
        setName("");
        setDescription("");
        setReason("");
        setOpen(false);
      } else setOutcome({ ok: false, error: result.error });
    } catch {
      setOutcome({ ok: false, error: "failed" });
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="flex max-w-xl flex-col gap-3 border border-rule p-3"
      aria-label={t("proposeHeading")}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <Field id={`${id}-name`} label={t("nameLabel")}>
        <Input id={`${id}-name`} value={name} maxLength={60} required onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field id={`${id}-parent`} label={t("parentLabel")} hint={t("parentHint")}>
        <NativeSelect id={`${id}-parent`} value={parentId} aria-describedby={hintId(`${id}-parent`)} onChange={(event) => setParentId(event.target.value)}>
          <option value="">{t("topLevel")}</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-description`} label={t("descriptionLabel")} hint={t("descriptionHint")}>
        <Textarea id={`${id}-description`} value={description} maxLength={600} aria-describedby={hintId(`${id}-description`)} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field id={`${id}-reason`} label={t("reasonLabel")}>
        <Textarea id={`${id}-reason`} value={reason} maxLength={600} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="default" size="sm" disabled={pending || !name.trim()}>
          {t("proposeSubmit")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      {outcome && !outcome.ok ? <RowStatus pending={false} saved={false} error={outcome.error} warning={null} role="alert" /> : null}
    </form>
  );
}
