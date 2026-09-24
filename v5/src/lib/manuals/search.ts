import { sql, type SQL } from "drizzle-orm";
import { can } from "../auth/permissions.ts";
import type { Role } from "../auth/roles.ts";
import { currentPdf } from "../data/manual-documents.ts";
import { isUuid } from "../data/uuid.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";
import { defaultEmbeddingTarget, embedQuery, toVectorLiteral, type EmbeddingTarget } from "./embed.ts";

/**
 * Hybrid search over manual passages (manual text spec §3.5, phase 2).
 *
 * 1. **Full text:** `websearch_to_tsquery('english', query)` against the
 *    generated `tsvector` (GIN), with its terms joined by OR rather than AND —
 *    a question ("how do I replace the resin tank on the Form 4") would
 *    otherwise need every word in one passage — and ranked by `ts_rank_cd`, so
 *    a passage holding more of the words ranks higher. Plus an **exact match on
 *    part-number-like tokens** (`E-302`, `3401-038`, `0300-0100-0001`), its own
 *    ranked list, because stemming and tokenising mangle exactly those.
 * 2. **Vector:** cosine distance on `embedding` (HNSW), top {@link CANDIDATES}.
 * 3. **Fuse** the lists with reciprocal rank fusion, k = {@link RRF_K}, and
 *    keep the top `limit` (default {@link DEFAULT_LIMIT}).
 * 4. **Merge** passages next to each other in the same section into one span,
 *    so the model reads a section, not fragments.
 * 5. **Access, in the SQL** (§8): a viewer who may edit tools (lab staff,
 *    `can(viewer, "tools.edit")`) searches every manual of every non-archived
 *    tool; anybody else only public files on published resources of published
 *    tools. Archived tools are never searched. Only a resource's *current* PDF
 *    counts — a stale archive copy of an edited link is invisible here too.
 *
 * If the query cannot be embedded (the Gateway's bad minute), the search
 * degrades to full text and says so (`vectorFailed`) instead of failing.
 *
 * Plain Node: relative imports — the live retrieval eval runs it.
 */

export const DEFAULT_LIMIT = 8;
/** How deep each ranked list goes before fusion. */
export const CANDIDATES = 30;
/** Reciprocal rank fusion's constant (Cormack et al.): score = Σ 1 / (k + rank). */
export const RRF_K = 60;

export type SearchMode = "hybrid" | "fts" | "vector";

/** Who is searching: anything carrying a role (an `Identity`), or nobody. */
export type ManualSearchViewer = { role: Role | null | undefined } | null | undefined;

/** Lab staff — the people who may edit tools — also search private and hidden manuals (spec §8). */
export function canSearchPrivateManuals(viewer: ManualSearchViewer): boolean {
  return can(viewer, "tools.edit");
}

export interface SearchManualsInput {
  query: string;
  /** Only these tools' manuals (catalogue ids). Absent: every manual the viewer may see. */
  toolIds?: readonly string[];
  limit?: number;
  viewer?: ManualSearchViewer;
  /** Which lists to fuse; `hybrid` in the app, the others for the retrieval eval. */
  mode?: SearchMode;
  /** The query's embedding model — must be the one the passages were embedded with. */
  target?: EmbeddingTarget;
  /** Skip merging adjacent passages (the retrieval eval compares raw passages too). */
  merge?: boolean;
  /** The query's embedding, already computed (the retrieval eval embeds each question once). */
  queryEmbedding?: number[];
}

export interface ManualPassage {
  documentId: string;
  toolId: string | null;
  toolName: string | null;
  toolSlug: string | null;
  documentTitle: string;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  /** The printed label of `pageStart`, when the PDF has page labels. */
  pageLabel: string | null;
  content: string;
  /** The stored PDF opened at `pageStart` (`…/manual.pdf#page=N`); null for a private file. */
  pdfUrl: string | null;
  /** Fused score (higher is better). */
  score: number;
  /** The passages merged into this one. */
  ordinals: number[];
}

export interface SearchManualsResult {
  passages: ManualPassage[];
  /** True when the query could not be embedded and only full text was searched. */
  vectorFailed: boolean;
  queryTokens: number;
  /** Dollars the Gateway reported for the query embedding; null when none. */
  cost: number | null;
}

/** Search manual passages. Never throws for an embedding failure; a database failure throws. */
export async function searchManuals(db: Db, input: SearchManualsInput): Promise<SearchManualsResult> {
  const query = input.query.trim().slice(0, 500);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 20));
  const mode = input.mode ?? "hybrid";
  const empty: SearchManualsResult = { passages: [], vectorFailed: false, queryTokens: 0, cost: null };
  if (!query) return empty;
  const toolIds = input.toolIds?.filter(isUuid);
  if (input.toolIds && (!toolIds || toolIds.length === 0)) return empty;

  let vector: string | null = null;
  let vectorFailed = false;
  let queryTokens = 0;
  let cost: number | null = null;
  if (mode !== "fts" && input.queryEmbedding) {
    vector = toVectorLiteral(input.queryEmbedding);
  } else if (mode !== "fts") {
    try {
      const embedded = await embedQuery(query, input.target ?? defaultEmbeddingTarget(), {
        abortSignal: AbortSignal.timeout(10_000),
      });
      vector = toVectorLiteral(embedded.embedding);
      queryTokens = embedded.tokens;
      cost = embedded.cost;
    } catch (error) {
      vectorFailed = true;
      console.warn(`[manuals] query embedding failed; full text only: ${error instanceof Error ? error.name : "error"}`);
    }
  }

  const includePrivate = canSearchPrivateManuals(input.viewer);
  const lexical = mode !== "vector" || vectorFailed;
  const rows = await rawRows<PassageRow>(
    db,
    fusedQuery({ query, toolIds, includePrivate, vector, lexical, tokens: partNumberTokens(query), limit })
  );

  const passages = rows.map(toPassage);
  return {
    passages: input.merge === false ? passages : mergeAdjacent(passages),
    vectorFailed,
    queryTokens,
    cost,
  };
}

// ── SQL ─────────────────────────────────────────────────────────────

interface PassageRow {
  document_id: string;
  ordinal: number;
  tool_id: string | null;
  tool_name: string | null;
  tool_slug: string | null;
  document_title: string;
  section_path: string[] | string;
  page_start: number;
  page_end: number;
  page_label: string | null;
  content: string;
  public_url: string | null;
  score: number | string;
}

function fusedQuery(args: {
  query: string;
  toolIds: readonly string[] | undefined;
  includePrivate: boolean;
  vector: string | null;
  lexical: boolean;
  tokens: string[];
  limit: number;
}): SQL {
  const access = args.includePrivate
    ? sql``
    : sql` and a.access = 'public' and r.published = true and t.published = true`;
  const scope = args.toolIds
    ? sql` and r.tool_id in (${sql.join(args.toolIds.map((id) => sql`${id}::uuid`), sql`, `)})`
    : sql``;

  const lists: SQL[] = [];
  if (args.lexical) {
    // The query's lexemes, as `websearch_to_tsquery` stems them; each weighted
    // by how rare it is among the passages searched (BM25's idf), times
    // `ts_rank` for that lexeme alone. A word every passage has — the tool's
    // own name, which the contextual header puts in all of them — weighs
    // nothing, and a passage holding more of the rare words ranks higher.
    lists.push(sql`select id, row_number() over (order by score desc, id) as rank
                     from (
                       select v.id, sum(s.idf * ts_rank(v.tsv, s.q)) as score
                         from visible v
                         join (
                           select t.q,
                                  ln(1 + ((select count(*) from visible) - count(v2.id) + 0.5) / (count(v2.id) + 0.5)) as idf
                             from (select distinct quote_literal(m[1])::tsquery as q
                                     from regexp_matches(websearch_to_tsquery('english', ${args.query})::text, '''((?:[^'']|'''')+)''', 'g') as m) as t
                             left join visible v2 on v2.tsv @@ t.q
                            group by t.q
                         ) as s on v.tsv @@ s.q
                        group by v.id
                     ) as scored
                    order by rank limit ${CANDIDATES}`);
    if (args.tokens.length > 0) {
      const hits = sql.join(
        args.tokens.map((token) => sql`(case when search_text ~* ${exactPattern(token)} then 1 else 0 end)`),
        sql` + `
      );
      lists.push(sql`select id, row_number() over (order by hits desc, id) as rank
                       from (select id, ${hits} as hits from visible) as h
                      where hits > 0
                      order by rank limit ${CANDIDATES}`);
    }
  }
  if (args.vector) {
    lists.push(sql`select id, row_number() over (order by embedding <=> ${args.vector}::vector, id) as rank
                     from visible
                    where embedding is not null
                    order by embedding <=> ${args.vector}::vector
                    limit ${CANDIDATES}`);
  }
  if (lists.length === 0) return sql`select null where false`;

  const union = sql.join(
    lists.map((list) => sql`(${list})`),
    sql` union all `
  );

  return sql`
    with visible as (
      select c.id, c.tsv, c.embedding, c.search_text
        from manual_chunks c
        join manual_documents d on d.id = c.document_id and d.status = 'ready'
        join attachments a on a.id = d.attachment_id
        join resources r on ${currentPdf("a", "r")}
        join tools t on t.id = r.tool_id
       where t.archived_at is null${access}${scope}
    ),
    ranked as (${union}),
    fused as (
      select id, sum(1.0 / (${RRF_K} + rank)) as score
        from ranked group by id
       order by score desc, id
       limit ${args.limit}
    )
    select c.document_id, c.ordinal, c.tool_id, t.name as tool_name, t.slug as tool_slug,
           d.title as document_title, c.section_path, c.page_start, c.page_end, p.page_label,
           c.content, a.public_url, f.score
      from fused f
      join manual_chunks c on c.id = f.id
      join manual_documents d on d.id = c.document_id
      join attachments a on a.id = d.attachment_id
      left join tools t on t.id = c.tool_id
      left join manual_pages p on p.document_id = c.document_id and p.page_number = c.page_start
     order by f.score desc, c.document_id, c.ordinal`;
}

/**
 * Tokens that look like part numbers or error codes: a digit plus a letter or
 * a separator, or four digits and more — `E-302`, `3401-038`, `M3x8`, `0300`.
 * Those are what full-text stemming splits apart, so they are matched exactly.
 */
export function partNumberTokens(query: string): string[] {
  const out = new Set<string>();
  for (const raw of query.split(/[\s,;()"'?!]+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (token.length < 3 || token.length > 40 || !/\d/.test(token)) continue;
    if (/[A-Za-z]/.test(token) || /[-_./]/.test(token) || token.length >= 4) out.add(token);
    if (out.size >= 6) break;
  }
  return [...out];
}

/** A case-insensitive POSIX regex matching `token` as a whole word. */
function exactPattern(token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return `(^|[^[:alnum:]])${escaped}($|[^[:alnum:]])`;
}

function toPassage(row: PassageRow): ManualPassage {
  const sectionPath = Array.isArray(row.section_path) ? row.section_path : parsePgArray(row.section_path);
  const pageStart = Number(row.page_start);
  return {
    documentId: row.document_id,
    toolId: row.tool_id,
    toolName: row.tool_name,
    toolSlug: row.tool_slug,
    documentTitle: row.document_title,
    sectionPath,
    pageStart,
    pageEnd: Number(row.page_end),
    pageLabel: row.page_label,
    content: row.content,
    pdfUrl: row.public_url ? `${row.public_url.split("#")[0]}#page=${pageStart}` : null,
    score: Number(row.score),
    ordinals: [Number(row.ordinal)],
  };
}

/** `{a,"b c"}` → `["a", "b c"]` — a driver that hands arrays back as text. */
function parsePgArray(text: string): string[] {
  const inner = text.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner))) out.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2]);
  return out;
}

// ── Merging ─────────────────────────────────────────────────────────

/**
 * Join passages that sit next to each other (consecutive ordinals) in the same
 * document and section into one span, keeping the best score and the order of
 * the best-scored member. The overlap the chunker repeated at the seam is
 * dropped, so the span reads once.
 */
export function mergeAdjacent(passages: readonly ManualPassage[]): ManualPassage[] {
  const groups = new Map<string, ManualPassage[]>();
  for (const passage of passages) {
    const key = `${passage.documentId}\u0000${passage.sectionPath.join("\u0001")}`;
    const list = groups.get(key) ?? [];
    list.push(passage);
    groups.set(key, list);
  }
  const merged: ManualPassage[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.ordinals[0] - b.ordinals[0]);
    let run = null as ManualPassage | null;
    for (const passage of sorted) {
      const current: ManualPassage | null = run;
      if (current && passage.ordinals[0] === current.ordinals[current.ordinals.length - 1] + 1) {
        run = {
          ...current,
          content: joinOverlapping(current.content, passage.content),
          pageEnd: Math.max(current.pageEnd, passage.pageEnd),
          score: Math.max(current.score, passage.score),
          ordinals: [...current.ordinals, ...passage.ordinals],
        };
      } else {
        if (run) merged.push(run);
        run = passage;
      }
    }
    if (run) merged.push(run);
  }
  return merged.sort((a, b) => b.score - a.score);
}

/** `a` then `b`, without the text `b` repeats from the end of `a`. */
function joinOverlapping(a: string, b: string): string {
  const max = Math.min(a.length, b.length, 800);
  for (let size = max; size >= 20; size -= 1) {
    if (a.endsWith(b.slice(0, size))) return `${a}${b.slice(size)}`;
  }
  return `${a}\n${b}`;
}
