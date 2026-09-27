import { useTranslations } from "next-intl";
import {
  confidenceLines,
  type ConfidenceBasisCode,
  type ConfidenceUnknownCode,
} from "../lib/capabilities/confidence";
import type {
  IntakeConfidence,
  IntakeConfidenceLevel,
  IntakeEvidence,
} from "../lib/capabilities/types";

/**
 * The confidence strip (confidence spec §6, spec §5.4 step 10): how sure
 * research is, on what basis, what it still does not know, and the pages it
 * actually read.
 *
 * Originally part of the chat's identification card (since removed); the
 * preliminary page on `/admin/intake/[id]` shows it over a `ResearchResult`.
 * It keeps the `intake` message keys it had there; since UI system phase 3 it
 * is drawn with utilities (the `id-card-*` rules it borrowed were deleted in
 * phase 1).
 *
 * The lines are rebuilt from the structured `evidence` so they are localized
 * like every other string — `confidence.basis` is the English, model-facing
 * copy and is not rendered.
 *
 * No directive: it holds no state, so a server component can render it as well
 * as a client island.
 */

export interface ConfidenceStripProps {
  confidence: IntakeConfidence;
  evidence: IntakeEvidence;
  /** Pages research actually read. Only http(s) links are ever rendered. */
  sourceUrls?: string[];
  /** Lead with what is unresolved rather than with what is held (medium). */
  unknownsFirst?: boolean;
  /**
   * True when `sourceUrls` are the pages research actually read (background
   * research's result), so a result that read only a video, or nothing, says
   * why its grade is capped (`readCap`). The chat card leaves it off.
   */
  sourcesAreReads?: boolean;
}

/**
 * Evidence marker. **No traffic lights** — a red/amber/green badge would import
 * a colour language the app does not otherwise use and would read as an error
 * state rather than a request for help (confidence spec §6). The established
 * convention instead, and the status glyphs' shapes (DESIGN.md §8.5) in ink
 * only: ● solid for evidence held, ○ hollow for unknown.
 */
function EvidenceMarker({ held }: { held: boolean }) {
  return (
    <span aria-hidden="true" className={held ? "text-micro text-foreground" : "text-micro text-muted-foreground"}>
      {held ? "●" : "○"}
    </span>
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
  videoOnly: "unknownVideoOnly",
  nothingRead: "unknownNothingRead",
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
export function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function ConfidenceStrip({
  confidence,
  evidence,
  sourceUrls,
  unknownsFirst,
  sourcesAreReads,
}: ConfidenceStripProps) {
  const t = useTranslations("intake");

  const lines = confidenceLines(evidence, sourcesAreReads ? { sourceUrls: sourceUrls ?? [] } : null);
  const sources = (sourceUrls || []).filter(isWebLink);

  const row = "flex items-baseline gap-2";
  const basisRows = lines.basis.map((line) => (
    <li key={`basis-${line.code}`} className={row}>
      <EvidenceMarker held />
      <span className="sr-only">{t("confidenceHeldAria")}</span>
      <span>{t(BASIS_KEYS[line.code], line.values)}</span>
    </li>
  ));
  const unknownRows = lines.unknowns.map((line) => (
    <li key={`unknown-${line.code}`} className={`${row} text-muted-foreground`}>
      <EvidenceMarker held={false} />
      <span className="sr-only">{t("confidenceUnknownAria")}</span>
      <span>{t(UNKNOWN_KEYS[line.code])}</span>
    </li>
  ));

  return (
    <section data-slot="confidence-strip" data-level={confidence.level} className="ui flex flex-col gap-1.5 text-table">
      <p className="font-mono text-label font-medium text-foreground uppercase">{t(LEVEL_KEYS[confidence.level])}</p>
      <ul className="flex flex-col gap-0.5">
        {unknownsFirst ? (
          <>
            {unknownRows}
            {basisRows}
          </>
        ) : (
          <>
            {basisRows}
            {unknownRows}
          </>
        )}
      </ul>
      {sources.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono text-micro tracking-[0.08em] uppercase">{t("confidenceSources")}: </span>
          {sources.map((url, i) => (
            <span key={url}>
              {i > 0 ? <span aria-hidden="true"> · </span> : null}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-ink underline underline-offset-2"
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
