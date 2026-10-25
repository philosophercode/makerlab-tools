# Lab Config — Design Spec

**Date:** 2026-10-25
**Status:** Approved for planning (owner, 2026-10-25)
**Target:** the app (repository root)
**Branch:** `claude/project-thread-kmp718`
**Spec PR:** #189 · **Implementation PR:** opens after this merges (Article 1)

## 1. Summary

Everything that makes this deployment the Cornell Tech MakerLAB's (its names, logo,
colours, address, staff, links, sign-in domain, timezone, hours, what the assistant
knows about the lab, and the floor plan) moves into **one typed file,
`lab/lab.config.ts`**, plus the files it points at: images in `public/lab/` and the
floor plan as JSON in `lab/floor-plan.json`. A lab that forks the repository edits that
file, drops in its logo, generates its floor plan with any vision model, and runs
`npm run lab:check`. It touches no other code.

Today the same facts are spread over about fifteen places: `siteConfig` defaults,
`roles.ts`, `lab-time.ts`, `demo-pass/config.ts`, two `site-url.ts` files,
`about-content.ts`, `lab-context.ts`, `lab-companion.ts`, three map imports and twelve
English message strings (times twelve locales). [`docs/fork.md`](../fork.md) lists them
as a table to hunt through. That table is the problem this spec removes.

The floor plan becomes **data instead of code**: a JSON file checked against a published
JSON Schema, so the prompt to "trace my floor plan" produces a file the app reads with no
wiring, and a checker says what is wrong with it before anyone opens `/map`.

This is a refactor of where values live, and it is **behaviour-preserving for the live
deployment**: the shipped `lab.config.ts` holds today's Cornell Tech values, every
existing environment variable still overrides its field, and the suite passes unchanged.

## 2. Goals / Non-goals

### Goals

- A fork changes the lab's identity by editing **`lab/lab.config.ts`** and
  **`public/lab/`** only. Checkable: after phase 1, no file under `src/` or `messages/`
  outside a comment or a test contains "Cornell", "Tata", "Roosevelt" or "Studio 101"
  (a test enforces it, §10).
- The config is **typed and validated**: a wrong field fails `npm run typecheck`; a bad
  value (a colour that is not a colour, an unknown timezone, a logo path that does not
  exist) fails `npm run lab:check` and the test suite, with a message naming the field.
- **Environment variables keep working** and win over the file, so one checkout can
  still serve several deployments (production and the demo lab) with different values.
- The floor plan is **`lab/floor-plan.json`**, validated by a schema the app also uses
  at runtime, with a **published JSON Schema** (`lab/floor-plan.schema.json`) and a
  documented prompt, so "give an AI your floor plan" yields a file the app uses as is.
- A lab with **no floor plan** sets `map: null` and the map features disappear cleanly
  (no `/map` link, no "Where is it?" thumbnail, the assistant says the lab has no map).

### Non-goals (this iteration)

- **No admin settings page for branding.** Identity is fixed per deploy (it is in the
  cacheable prompt prefix and in build-time CSS); a database-backed editor is a
  different, larger design.
- **No in-app floor-plan upload** in phases 1–2. §5.4 sketches it as phase 3, undecided.
- **No multi-lab tenancy.** One deployment, one lab.
- **Not translating lab data.** People's titles, photo captions and the assistant's lab
  description are the lab's own words in the lab's language, like tool names (§6).
- **Not removing env vars.** They stay as overrides; none is deprecated.

## 3. Architecture

### 3.1 Files

```
lab/
  lab.config.ts          ← the one file a lab edits (typed: defineLab({...}))
  floor-plan.json        ← the traced plan (or absent, with map: null)
  floor-plan.schema.json ← generated from the Zod schema; given to the model
  README.md              ← what each field does, in five minutes
public/lab/              ← logo.svg, logo.png, wordmark.svg, photos
src/lib/lab/
  schema.ts              ← Zod schema for LabConfig (and FloorPlan via src/lib/map/schema.ts)
  config.ts              ← resolveLab(): file values, env overrides applied, validated once
```

`lab/` sits at the repository root, outside `src/`, so a fork's diff against upstream is
one folder and merges from upstream rarely conflict with it. It is plain TypeScript with
relative imports and no `server-only` (the scripts and `next.config.ts` load it under
plain Node, AGENTS.md "Imports").

### 3.2 Precedence

For every field that has an env var today: **env var (when set and valid) → `lab.config.ts`
→ nothing.** Fields with no env var today come from the file only. The current hardcoded
defaults move *into* the shipped file; no code keeps a Cornell default.

`siteConfig` stays the import every component uses (Article 6 names it), now built from
`resolveLab()`. Its shape is unchanged, so no call site changes in phase 1. New fields
(address, people, links, …) are reached through `lab` from `@/lib/lab/config`.

Client components still need `NEXT_PUBLIC_*` values inlined at build time. `next.config.ts`
reads the resolved config and passes the public fields through `env`, so the file is the
source and the build inlines it; no client bundle imports `lab.config.ts` directly.

### 3.3 What moves where

| Today | Becomes | Field |
|---|---|---|
| `site-config.ts` defaults (name, institution, tagline, assistant name, audience, logo, wordmark, hours, colours) | `lab.config.ts` | `identity.*`, `brand.*`, `place.hours` |
| `share/site-url.ts`, `qr/site-url.ts` `DEFAULT_SITE_URL` | `lab.config.ts` | `web.siteUrl` |
| `roles.ts` `DEFAULT_EMAIL_DOMAIN` | `lab.config.ts` | `access.emailDomain` |
| `lab-time.ts` `DEFAULT_LAB_TIMEZONE` | `lab.config.ts` | `place.timezone` |
| `demo-pass/config.ts` `DEFAULT_DEMO_PASS_CONTACT_EMAIL` | `lab.config.ts` | `contact.demoEmail` |
| `about/about-content.ts` people, links, photos | `lab.config.ts` | `people`, `links`, `photos` |
| `ai/lab-context.ts` the lab and institution paragraphs | `lab.config.ts` | `assistant.aboutLab` (Markdown) |
| `ai/lab-companion.ts` "MakerLAB community", "SuperMaker" | `lab.config.ts` | `identity.labName`, `assistant.helperTitle` |
| `map/studio-101.ts` + three imports | `lab/floor-plan.json` | `map` |
| 12 `messages/*.json` strings naming Cornell, Tata, the address | ICU arguments (`{institution}`, `{labName}`, `{address}`) filled from `lab` | — |
| `public/brand/*` | `public/lab/*` (old paths kept as copies for one release, for printed QR sheets) | `brand.logo`, `brand.wordmark` |
| demo seed `@cornell.edu` addresses | `@${access.emailDomain}` | — |

Kept as is, deliberately:

- **`lab-context.ts` keeps its generic paragraph** ("What you do": operate, debug, create,
  send unknowns to staff). Only the facts about the lab move. The block is still static
  per deploy, so it stays in the cacheable prefix (Article 4).
- **The QR matcher's known legacy hosts** (`qr/match.ts`) stay a list in code: they are
  this deployment's history of printed labels, not branding. `web.siteUrl` is added to
  the list at runtime.
- **The original author's credit** on About and `/product` stays (it credits the
  software), with the lab's name as an argument.
- **`/product`** describes the software and shows the Cornell site's screenshots. A
  `pages.product: boolean` field (default `true`) lets a fork hide it; replacing its
  screenshots stays a fork's own choice (`docs/fork.md`).

## 4. Data model

No database change. The config type, sketched (the Zod schema in `src/lib/lab/schema.ts`
is the source; the type is `z.infer` of it):

```ts
export interface LabConfig {
  identity: {
    siteName: string;          // "MakerLAB Tools"          NEXT_PUBLIC_SITE_NAME
    labName: string;           // "MakerLAB"
    institution: string;       // "Cornell Tech"            NEXT_PUBLIC_INSTITUTION
    tagline: string;           //                           NEXT_PUBLIC_TAGLINE
    assistantName: string;     // "MakerLAB AI"             NEXT_PUBLIC_CHAT_ASSISTANT_NAME
    audience: string;          //                           AUDIENCE
  };
  brand: {
    logo: string;              // "/lab/logo.svg" (one colour; drawn as a mask)   NEXT_PUBLIC_LOGO
    wordmark: string;          //                                                NEXT_PUBLIC_WORDMARK
    colors: { primary: string; primaryDark: string };  // hex      NEXT_PUBLIC_COLOR_PRIMARY(_DARK)
  };
  web: {
    siteUrl: string;           // "https://www.makerlabai.app"   NEXT_PUBLIC_SITE_URL
    sourceUrl: string;         // the public repo (identity amendment 2026-10-21)  NEXT_PUBLIC_SOURCE_URL
  };
  place: {
    building: string;          // "Tata Innovation Center, first floor"
    address: string;           // one line
    directions?: string;       // "just inside the main entrance, on the left"
    timezone: string;          // IANA, checked with Intl   LAB_TIMEZONE
    hours: string;             // display line              NEXT_PUBLIC_LAB_HOURS
  };
  access: { emailDomain: string };  //                        AUTH_ALLOWED_EMAIL_DOMAIN
  contact: { demoEmail: string | null };  // null = About's contacts   DEMO_PASS_CONTACT_EMAIL
  people: { name: string; title: string; email?: string }[];
  links: { official?: string; youtube?: string; instagram?: string };
  photos: { src: string; width: number; height: number; alt: string; caption?: string }[];
  assistant: {
    aboutLab: string;          // Markdown: the lab, its building, staff, hours, institution
    helperTitle: string;       // "SuperMaker": whom the assistant suggests asking
  };
  pages: { product: boolean };
  map: FloorPlan | null;       // import plan from "./floor-plan.json"
}
```

`defineLab(config)` is an identity function that gives the file autocompletion and type
errors; `resolveLab()` parses it with the schema, applies env overrides, and throws once
at startup with every invalid field named. `FloorPlan` keeps today's shape
(`src/lib/map/types.ts`) and gains a Zod schema (`src/lib/map/schema.ts`) whose
`z.toJSONSchema` output is committed as `lab/floor-plan.schema.json`; a test fails when
the committed file is stale.

The plan is still shown to signed-in people only (`src/lib/map/access.ts`, PR #98): the
JSON is imported only by `server-only` modules, and a test keeps it out of client bundles
the way `studio-101.ts`'s `import "server-only"` does today.

## 5. Behavior / flow

### 5.1 A lab forks it

1. Edit `lab/lab.config.ts` (the shipped Cornell file is the worked example; every field
   has a comment).
2. Put the logo, wordmark and photos in `public/lab/`.
3. Floor plan: §5.3, or `map: null`.
4. `npm run lab:check`: validates the config and the plan, checks every `public/` path
   exists, prints what the header, About and the assistant's "Where you are" will say.
5. `npm run dev`, `npm run test:all`.

### 5.2 `npm run lab:check`

`scripts/lab-check.ts`, no network, no credentials. Exits non-zero with one line per
problem. Checks:

- the config parses (types, hex colours, an `Intl` timezone, URLs, email shapes);
- every `brand.*` and `photos[].src` file exists under `public/`, and an SVG logo has its
  PNG twin (QR sheets and the link-preview card need it);
- the plan, when present: valid against the schema; ids unique; every station's `zoneId`
  names a zone; each `labelAt` and station mark lies inside its zone's polygon; zone
  polygons do not overlap; everything lies inside `viewBox`; `(room, zone)` pairs unique;
- with `--inventory` (needs `DATABASE_URL`, reads only): which locations in the database
  match no zone or station, and which zones no tool uses. This is the "match the
  inventory to it" step of `docs/map.md`, made a list instead of a guess.

`npm run lab:map-preview -- --image plan.png` writes `lab/.preview.html` (git-ignored):
the plan's SVG drawn over the source image at 50% opacity, so a person checks the trace
by eye before committing.

### 5.3 "Give an AI your floor plan" (phase 2)

The flow `docs/map.md` documents, with JSON in place of TypeScript:

1. Mark zones (numbers) and stations (letters) on any plan image, with a legend.
2. Give a vision model (Claude, ChatGPT, Gemini) the image, `lab/floor-plan.schema.json`,
   the Cornell `floor-plan.json` as an example, the room and zone names the inventory
   uses, and the prompt in `docs/map.md`. It answers with one JSON object.
3. Save it as `lab/floor-plan.json`; `npm run lab:check` and `lab:map-preview`.
4. Fix what the checker names, by hand or by pasting its output back to the model.

No new model job and no cost to the app: the lab uses whatever model it already has.
JSON rather than TypeScript because every model emits it reliably, every model's
structured-output mode can take the schema directly, and nobody has to edit imports.

### 5.4 In-app tracing (phase 3, undecided)

Sketch only, for the owner to decide later: on Settings, a super admin uploads a plan
image; a `mapTrace` job (vision model, structured output against the same schema) drafts
the plan; the page shows it over the image; the admin approves it (Article 5: a draft
until a person publishes). This needs the plan in Postgres rather than a file, a
migration, an action and permission, and a model cost per attempt. It is a spec of its own.

### 5.5 Unhappy paths

- **Invalid config:** the build and `npm run dev` stop with every bad field named;
  never a half-branded site.
- **Invalid env override** (e.g. `LAB_TIMEZONE=Mars/Base`): the file's value is used and
  a warning logged, as `lab-time.ts` and `demo-pass/config.ts` already do today
  (Article 4, fail toward stale).
- **`map: null`:** `/map` answers 404, nav and thumbnails hide, `get_tool_details`
  returns `map: null` and the assistant says the lab has no map.

## 6. UI

No visible change for the live deployment (the values are the same). For a fork, every
page that names the lab reads it from the config.

Lab data (people's titles, photo captions, `assistant.aboutLab`) is **not** translated:
it is the lab's own words, like tool names and lab notes. The words around them stay in
`next-intl` (Article 6). The twelve message strings that name the lab take arguments
instead (`"title": "The {labName} at {institution}"`), in all twelve locales in one PR.
The About page's two `roleKey` titles ("Director, …") become `people[].title`, and their
twelve translations are dropped; this is the one place the change removes translated
text (§11 Q2).

## 7. Relationship to existing work

- **Identity spec** (2026-09-28): `siteConfig`, the "Where you are" block, About. This
  spec moves their values; their behaviour is unchanged.
- **Floor map spec** (2026-09-25) and `docs/map.md`: the plan's shape is unchanged; its
  storage moves from `studio-101.ts` to JSON, and the three hand-edited imports go.
- **PR #188** (open) adds `siteConfig.sourceUrl` and `NEXT_PUBLIC_SOURCE_URL`; the
  implementation PR builds on it as `web.sourceUrl`. **PR #187** (open) changes
  `demo-pass/config.ts`. The implementation PR opens after both merge, rebased on them,
  so neither needs to change.
- `DEFAULT_SITE_URL` (deferred in the public-launch work because `qr/match.ts` uses it as
  a known host): settled here by §3.3, `web.siteUrl` plus the legacy host list.

## 8. Security and safety

- **No secrets in `lab.config.ts`.** It is committed and partly inlined into client
  bundles. Keys stay in env vars; the schema has no field for one, and `lab:check` warns
  on anything shaped like a key.
- **The floor plan stays signed-in only** (§4).
- **`access.emailDomain` is the sign-in boundary.** It moves file, not meaning: the env
  var still wins, `isAllowedEmail` still enforces it server-side on every request, and a
  test pins the Cornell value so a careless edit of the shipped file fails CI.
- **Staff emails in `people`** are already public on the lab's page; a fork's comment in
  the file says only to list addresses the lab publishes.

## 9. Build order

1. **Phase 1, config file.** `lab/` and `src/lib/lab/`, `siteConfig` built from it, the
   moves in §3.3 except the map, message arguments in all locales, `pages.product`,
   `lab:check` without plan checks, the no-Cornell test, `docs/fork.md` rewritten around
   the file. Behaviour-preserving for production.
2. **Phase 2, floor plan as data.** `src/lib/map/schema.ts`, `lab/floor-plan.json` (the
   Studio 101 plan converted, coordinates identical), the generated JSON Schema,
   `map: null` handling, plan checks and `--inventory` in `lab:check`, `lab:map-preview`,
   `docs/map.md`'s prompt rewritten for JSON. Delete `studio-101.ts`.
3. **Phase 3** (undecided, own spec): in-app tracing, §5.4.

## 10. Testing

- **Unit:** the schema accepts the shipped file and rejects each bad field with its path;
  precedence (env set, unset, invalid) for every overridable field; `defineLab` types
  (a `tsd`-style compile test); the plan geometry checks on a fixture of each failure.
- **Consistency:** `floor-plan.schema.json` matches `z.toJSONSchema` of the schema; the
  converted `floor-plan.json` equals today's `STUDIO_101` point for point (run once in
  phase 2, before the TS file is deleted).
- **Guard:** no "Cornell", "Tata", "Roosevelt" or "Studio 101" in `src/` or `messages/`
  outside comments and tests.
- **Component / E2E:** existing tests keep passing against the shipped config; one E2E
  boots with a fixture lab (a second config via `LAB_CONFIG_PATH`, test-only) and checks
  the header, About and `/map` show the fixture's values, and that `map: null` hides the
  map.
- **Evals:** none change; `npm run eval:all` after phase 1 confirms the assistant's
  "Where you are" answers are the same.

## 11. Decisions (owner, 2026-10-25)

The owner took the recommended answer to each open question:

1. **Config file name and place:** `lab/lab.config.ts` at the repository root, one folder
   a fork owns.
2. **Staff titles** (§6): not translated. A title shows as written in every locale, like a
   name.
3. **`/product` for forks:** stays on (`pages.product: true`); a fork turns it off if it
   wants.
4. **Phase 3** (in-app tracing): no spec yet; wait until a second lab asks.
