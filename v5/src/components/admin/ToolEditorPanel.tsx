"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  InventoryActionError,
  InventoryActionResult,
  InventoryActionWarning,
  ToolEditorPayload,
} from "../../app/admin/inventory/action-result";
import { PhotoEditor } from "./PhotoEditor";
import { ResourcesEditor } from "./ResourcesEditor";
import { ToolFieldsForm } from "./ToolFieldsForm";
import { ToolStateControls } from "./ToolStateControls";
import { UnitsEditor } from "./UnitsEditor";
import type { ToolEditorActions } from "./tool-editor-actions";

/**
 * The tool editor (spec §5.3(3)–(5), §6).
 *
 * **One panel, two surfaces.** It opens as a side panel from the review table
 * and as a full-screen sheet over a tool's own page, which is the phone-first
 * case the spec names: a SuperMaker marking a printer out of service is
 * standing next to the machine with one hand free. `variant` is the only
 * difference, and it is a class name.
 *
 * **It is deliberately small.** It owns four things — the revision token, what
 * is in flight, what the last write said, and the conflict — and delegates
 * every field to a section component beside it.
 *
 * **The revision is the whole contract.** It is minted by `load` when the panel
 * *opens*, not when the page rendered, and every write carries it back. A write
 * that lands returns the next one; a write that conflicts returns nothing, and
 * then:
 *
 * - nothing was written, so the person's unsaved edits are still the only copy
 *   of their work and the panel keeps them;
 * - the message is **inline**, never a modal — a dialog over unsaved text is
 *   how the text gets lost (§6, States);
 * - **Reload** fetches the newer version and hands it to the fields form as
 *   `theirs`, so every field where the two disagree shows both and the person
 *   chooses. That is what "nothing is lost when they reload" means.
 *
 * **The actions arrive as props.** Importing them here would drag
 * `next/headers`, the limiter and `server-only` into the client graph and make
 * this untestable — the rule `RoleSelect` set in Phase 4.
 *
 * **No `useTransition` around a write**, for the reason `RoleSelect` documents:
 * every action ends in `revalidatePath`, and a transition would hold the
 * confirmation hostage to a whole server re-render.
 */

export interface ToolEditorPanelProps {
  /** A slug or a uuid — whatever the surface that opened the panel has. */
  idOrSlug: string;
  /** The name to show while it loads, from the row or page that opened it. */
  toolName: string;
  actions: ToolEditorActions;
  /** Whether the viewer holds `tools.publish`. Presentation only; §8. */
  canPublish?: boolean;
  /** `sheet` is the phone-first full-screen form over a tool page (§6). */
  variant?: "panel" | "sheet";
  onClose: () => void;
}

/** What the panel is doing, as far as the person watching is concerned. */
type Phase = "loading" | "ready" | "unavailable";

export function ToolEditorPanel({
  idOrSlug,
  toolName,
  actions,
  canPublish = true,
  variant = "panel",
  onClose,
}: ToolEditorPanelProps) {
  const t = useTranslations("admin.inventory.editor");
  // Refusals and warnings are shared across every admin surface, so they live
  // one level up — `admin.errors.*` / `admin.warnings.*`, the same strings
  // `/admin/users` renders.
  const tAdmin = useTranslations("admin");

  const [phase, setPhase] = useState<Phase>("loading");
  const [editor, setEditor] = useState<ToolEditorPayload | null>(null);
  const [revision, setRevision] = useState<string | null>(null);

  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<InventoryActionError | null>(null);
  const [warning, setWarning] = useState<InventoryActionWarning | null>(null);

  /** The newer version, after a conflict reload. See the note above. */
  const [theirs, setTheirs] = useState<ToolEditorPayload | null>(null);
  /**
   * Bumped only when the panel wants the fields form rebased on server values —
   * after a save it knows landed. Never after a conflict reload, which would
   * throw away the text the conflict exists to protect.
   */
  const [formEpoch, setFormEpoch] = useState(0);

  /**
   * Open: read the tool, and take the token that read minted.
   *
   * The state lands in the promise's callback rather than in the effect body,
   * which is both what the lint rule asks for and what lets a panel closed
   * mid-read stop rather than setting state on its way out.
   */
  useEffect(() => {
    let cancelled = false;

    void actions.load(idOrSlug).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPhase("unavailable");
        setError(result.error);
        return;
      }
      setEditor(result.editor);
      setRevision(result.editor.tool.revision);
      setPhase("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [actions, idOrSlug]);

  /**
   * Run one write with the token the panel holds, and take whatever it says.
   *
   * `refresh` re-reads the children after a write that changed them — a new
   * unit has an id only the server knows. **It deliberately keeps the revision
   * the write returned** rather than the one the re-read mints: if somebody
   * else wrote in between, taking the fresher token would let the next save
   * overwrite their change without ever reporting a conflict.
   */
  async function run<T>(
    call: (token: string) => Promise<InventoryActionResult<T>>,
    options: { refresh?: boolean } = {}
  ) {
    if (!revision || pending) return;

    setPending(true);
    setError(null);
    setWarning(null);
    setSaved(false);

    try {
      const result = await call(revision);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setRevision(result.revision);
      setWarning(result.warning ?? null);
      setSaved(true);
      // The conflict is over: this write went in against a token the database
      // accepted, so there is no longer another version to choose between.
      setTheirs(null);

      if (options.refresh) await refreshChildren();
    } catch {
      // A server action that never answered — a dropped connection, a redeploy
      // mid-click. Nothing is assumed to have landed.
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  /**
   * Re-read the children **and the tool's state**, keeping the token the write
   * returned.
   *
   * The state half is not incidental: Publish, Unpublish, Archive, Restore and
   * *Looks good* all commit through here, and a panel that went on rendering
   * the old state would say "Saved" over a badge still reading Published and a
   * button still offering to unpublish — the page asserting what the database
   * no longer holds, which is the one thing `./action-result.ts` says a write
   * that landed must never do. Clicking it again would then write a second
   * `tool.unpublished`, and Archive would hide Restore behind a reopen.
   *
   * The tool's **text** is deliberately left alone, for the reason
   * `ToolFieldsForm` documents: somebody may be halfway through typing it, and
   * nothing copies a server value over a box in use. Only `refreshFields`,
   * called after a fields save this panel performed, replaces those.
   */
  async function refreshChildren() {
    const result = await actions.load(idOrSlug);
    if (!result.ok) return;
    setEditor((current) =>
      current
        ? {
            ...current,
            units: result.editor.units,
            resources: result.editor.resources,
            photos: result.editor.photos,
            tool: { ...current.tool, ...stateOnly(result.editor) },
          }
        : result.editor
    );
  }

  /**
   * What **Reload** does after a conflict: take the newer version and the token
   * that goes with it, and keep every unsaved edit on screen beside it.
   */
  async function reloadAfterConflict() {
    setPending(true);
    try {
      const result = await actions.load(idOrSlug);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTheirs(result.editor);
      setRevision(result.editor.tool.revision);
      setEditor((current) =>
        current
          ? {
              ...current,
              // The children are theirs now. The sections that hold no unsaved
              // state simply re-render; the one that does — a unit row's text
              // boxes — rebases itself field by field, taking the newer value
              // wherever nobody has typed and keeping the typing where they
              // have. Handing them the newer rows is what makes that possible.
              units: result.editor.units,
              resources: result.editor.resources,
              photos: result.editor.photos,
              tool: {
                ...current.tool,
                ...stateOnly(result.editor),
                revision: result.editor.tool.revision,
              },
            }
          : result.editor
      );
      setError(null);
    } finally {
      setPending(false);
    }
  }

  /** Re-read the tool row itself, after a save this panel performed. */
  async function refreshFields() {
    const result = await actions.load(idOrSlug);
    if (!result.ok) return;
    setEditor((current) => (current ? { ...current, tool: result.editor.tool } : result.editor));
  }

  const className = `admin-editor is-${variant}`;

  if (phase !== "ready" || !editor) {
    return (
      <aside className={className} aria-label={t("panelLabel", { name: toolName })}>
        <header className="admin-editor-head">
          <h3>{toolName}</h3>
          <button type="button" className="admin-button" onClick={onClose}>
            {t("close")}
          </button>
        </header>
        <p
          className={`admin-row-status${phase === "unavailable" ? " is-error" : ""}`}
          role="status"
        >
          {phase === "loading" ? t("loading") : null}
          {phase === "unavailable" && error ? tAdmin(`errors.${error}`) : null}
        </p>
      </aside>
    );
  }

  const { tool } = editor;

  return (
    <aside className={className} aria-label={t("panelLabel", { name: tool.name })}>
      <header className="admin-editor-head">
        <h3>{tool.name}</h3>
        <button type="button" className="admin-button" onClick={onClose}>
          {t("close")}
        </button>
      </header>

      {/* Inline, above the form it is about, and it never removes anything from
          the page — the unsaved edits below it are the only copy that exists. */}
      {error === "conflict" ? (
        <div className="admin-editor-conflict" role="alert">
          <p>{tAdmin("errors.conflict")}</p>
          <button type="button" className="admin-button" disabled={pending} onClick={() => void reloadAfterConflict()}>
            {t("reload")}
          </button>
        </div>
      ) : null}

      {/* One live region for every outcome, so a screen reader hears a refusal
          in the same place it heard the confirmation (the `RoleSelect` rule). */}
      <p
        className={`admin-row-status${error ? " is-error" : ""}${
          !error && warning ? " is-warning" : ""
        }`}
        role="status"
      >
        {pending ? t("saving") : null}
        {!pending && saved && !error && !warning ? t("saved") : null}
        {!pending && warning ? tAdmin(`warnings.${warning}`) : null}
        {!pending && error && error !== "conflict" ? tAdmin(`errors.${error}`) : null}
      </p>

      <ToolStateControls
        tool={tool}
        canPublish={canPublish}
        pending={pending}
        onMarkReviewed={() =>
          void run((token) => actions.markReviewed(args(tool.id, token)), { refresh: true })
        }
        onPublish={() => void run((token) => actions.publish(args(tool.id, token)), { refresh: true })}
        onUnpublish={() =>
          void run((token) => actions.unpublish(args(tool.id, token)), { refresh: true })
        }
        onArchive={() => void run((token) => actions.archive(args(tool.id, token)), { refresh: true })}
        onRestore={() => void run((token) => actions.restore(args(tool.id, token)), { refresh: true })}
      />

      <section className="admin-editor-section">
        <h4>{t("sectionFields")}</h4>
        <ToolFieldsForm
          key={formEpoch}
          values={tool}
          theirs={theirs?.tool ?? null}
          categories={editor.categories}
          locations={editor.locations}
          pending={pending}
          onSave={(patch) =>
            void run(
              async (token) => {
                const result = await actions.save({ ...args(tool.id, token), patch });
                if (result.ok) {
                  // Rebase the form on what the database now holds, so its next
                  // patch is a diff against the truth rather than against what
                  // the panel opened with.
                  await refreshFields();
                  setFormEpoch((epoch) => epoch + 1);
                }
                return result;
              }
            )
          }
        />
      </section>

      <section className="admin-editor-section">
        <h4>{t("sectionUnits")}</h4>
        <UnitsEditor
          units={editor.units}
          pending={pending}
          onAdd={(unitLabel) =>
            void run((token) => actions.addUnit({ ...args(tool.id, token), unit: { unitLabel } }), {
              refresh: true,
            })
          }
          onEdit={(unitId, patch) =>
            void run((token) => actions.editUnit({ ...args(tool.id, token), unitId, patch }), {
              refresh: true,
            })
          }
          onRetire={(unitId) =>
            void run((token) => actions.retireUnit({ ...args(tool.id, token), unitId }), {
              refresh: true,
            })
          }
          onDelete={(unitId) =>
            void run((token) => actions.deleteUnit({ ...args(tool.id, token), unitId }), {
              refresh: true,
            })
          }
        />
      </section>

      <section className="admin-editor-section">
        <h4>{t("sectionResources")}</h4>
        <ResourcesEditor
          resources={editor.resources}
          pending={pending}
          onAdd={(resource, fileAttachmentIds) =>
            void run(
              (token) =>
                actions.addResource({
                  ...args(tool.id, token),
                  resource,
                  fileAttachmentIds,
                }),
              { refresh: true }
            )
          }
          onTogglePublished={(resourceId, published) =>
            void run(
              (token) =>
                actions.editResource({ ...args(tool.id, token), resourceId, patch: { published } }),
              { refresh: true }
            )
          }
          onRemove={(resourceId) =>
            void run((token) => actions.removeResource({ ...args(tool.id, token), resourceId }), {
              refresh: true,
            })
          }
          onReprocess={(resourceId) =>
            void run((token) => actions.reprocessManual({ ...args(tool.id, token), resourceId }), {
              refresh: true,
            })
          }
        />
      </section>

      <section className="admin-editor-section">
        <h4>{t("sectionPhotos")}</h4>
        <PhotoEditor
          photos={editor.photos}
          pending={pending}
          onAttach={(attachmentIds) =>
            void run((token) => actions.attachPhotos({ ...args(tool.id, token), attachmentIds }), {
              refresh: true,
            })
          }
          onReorder={(orderedIds) =>
            void run((token) => actions.reorderPhotos({ ...args(tool.id, token), orderedIds }), {
              refresh: true,
            })
          }
          onRemove={(attachmentId) =>
            void run((token) => actions.removePhoto({ ...args(tool.id, token), attachmentId }), {
              refresh: true,
            })
          }
        />
      </section>
    </aside>
  );
}

/** The two things every write is told. */
function args(toolId: string, expectedRevision: string) {
  return { toolId, expectedRevision };
}

/**
 * The parts of a freshly-read tool that are state rather than text.
 *
 * After a conflict reload the panel adopts the other person's *state* — whether
 * the tool is published, archived, reviewed — because those are not fields
 * anybody is halfway through typing, and showing the old ones would put a
 * Publish button on a tool somebody already published. `refreshChildren` adopts
 * the same set after a state change of the panel's own.
 *
 * **The revision is not in here**, because the two callers want different ones:
 * a reload takes the token it just read, and a refresh after a write keeps the
 * token that write returned — taking the fresher one there would let the next
 * save overwrite somebody else's change without ever reporting a conflict.
 */
function stateOnly(editor: ToolEditorPayload) {
  const { published, archivedAt, lastReviewedAt, lastReviewedBy } = editor.tool;
  return { published, archivedAt, lastReviewedAt, lastReviewedBy };
}
