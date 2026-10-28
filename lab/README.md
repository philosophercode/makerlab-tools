# `lab/`: your lab, in one folder

Everything that makes a deployment one particular lab's lives here and in `public/lab/`.
A fork edits these and nothing else in the app
([lab config spec](../docs/specs/2026-10-25-lab-config-design.md),
[fork guide](../docs/fork.md)).

| File | What it is |
|---|---|
| [`lab.config.ts`](lab.config.ts) | The lab: names, logo, colours, hours, sign-in domain, people, links, photos, About's words, what the assistant knows, and whether there is a map |
| [`floor-plan.json`](floor-plan.json) | The floor plan, traced from an image ([`docs/map.md`](../docs/map.md)) |
| [`floor-plan.schema.json`](floor-plan.schema.json) | The plan's JSON Schema, generated (`npm run lab:schema`); give it to the model that traces your plan |
| `../public/lab/` | `logo.svg` and its `logo.png` twin, `wordmark.svg`, the About photos |

## The config, in five minutes

| Section | What it changes |
|---|---|
| `identity` | The site's name, the lab's name, the institution, the tagline, the assistant's name, who the assistant talks to |
| `brand` | Logo and wordmark (paths under `public/`), the accent colours |
| `web` | The public address (QR labels, link previews) and the fork's source code (AGPL-3.0) |
| `place` | The timezone and the one-line hours |
| `access` | `emailDomain`: anyone with an address there may sign in |
| `email` | The notifications' sender and reply-to (`null` keeps mail off) |
| `contact` | The address a spent demo pass offers |
| `locale` | The default language |
| `people`, `links`, `photos`, `about` | The About page |
| `assistant` | `aboutLab`, the facts the assistant states about the lab; `helperTitle`, whom it suggests asking |
| `pages` | `product: false` hides `/product` |
| `map` | `true` uses `floor-plan.json`; `false` hides every map feature |

Text About shows (`about.*`, photo alt text and captions, link labels) can be one string
or one per language, `{ en: "…", es: "…" }`; a language it leaves out reads the English.
Names and titles show as written.

## Rules

- **No secrets.** This folder is committed and parts of it reach the browser. Keys stay
  in environment variables. So do the individual sign-in addresses
  (`AUTH_ALLOWED_EMAILS`, `AUTH_SUPER_ADMIN_EMAILS`): only the domain is here.
- **Only addresses the lab publishes** in `people`.
- **Environment variables win.** A field with a variable named beside it in the file is
  overridden by it when set, so one checkout serves several deployments.
- **Check before you commit:** `npm run lab:check` validates the config and the plan,
  checks the images exist, and prints what the site will say. An invalid config also
  stops `npm run dev` and the build.
