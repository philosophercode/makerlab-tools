# Fork it for your lab

> MakerLAB Tools was built for the Cornell Tech MakerLAB, but nothing in it is specific to
> one lab that an environment variable or a short list of files cannot change. This page
> is the path from a fork to your own lab's site. Setting up each service is in
> [`deploy.md`](deploy.md); this page says what to change on the way.

## 1 · Fork and run it (5 minutes)

```bash
# after "Fork" on GitHub
git clone https://github.com/<you>/makerlab-tools.git
cd makerlab-tools
npm install
npm run dev            # http://localhost:3000 — demo data, no keys needed
npm run test:all       # passes with no credentials and no network
```

With nothing configured you get an in-process Postgres seeded with two demo tools and a
**demo data** banner. Add `AI_GATEWAY_API_KEY` to `.env.local` to turn the assistant on
([`deploy.md`](deploy.md) Stage 1).

> **Coming: one file.** The [lab config spec](specs/2026-10-25-lab-config-design.md)
> moves everything in sections 2 and 3 into `lab/lab.config.ts` (plus your images in
> `public/lab/` and your floor plan as `lab/floor-plan.json`), checked by
> `npm run lab:check`. Until it is built, use the tables below.

## 2 · Rebrand with environment variables

Copy [`.env.example`](../.env.example) to `.env.local`. These change the name, look and
audience without touching code:

| Variable | What |
|---|---|
| `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_INSTITUTION`, `NEXT_PUBLIC_TAGLINE` | Names in the header, titles and link previews |
| `NEXT_PUBLIC_CHAT_ASSISTANT_NAME`, `AUDIENCE` | The assistant's name and who it is talking to |
| `NEXT_PUBLIC_LOGO`, `NEXT_PUBLIC_WORDMARK` | Your logo and wordmark, in `public/` |
| `NEXT_PUBLIC_COLOR_PRIMARY`, `NEXT_PUBLIC_COLOR_PRIMARY_DARK` | Accent colours |
| `NEXT_PUBLIC_LAB_HOURS` | The hours line in the header and on the kiosk |
| `NEXT_PUBLIC_SITE_URL` | Your public address, for QR labels and link previews |
| `AUTH_ALLOWED_EMAIL_DOMAIN`, `AUTH_ALLOWED_EMAILS` | Who may sign in (defaults to `cornell.edu`) |
| `DEMO_PASS_CONTACT_EMAIL` | The address a spent demo pass offers (defaults to the original author's) |

## 3 · Replace what is Cornell's

The licence covers the code, not Cornell's names, logos or photos
([`LICENSING.md`](../LICENSING.md)). Before you put a fork online, replace:

| Where | What is there now |
|---|---|
| `public/brand/` | The Cornell Tech MakerLAB logo and wordmark (point the variables above at your own files) |
| `src/app/about/about-content.ts` | The lab's staff, their addresses, the official page and social links, photos of the lab |
| `public/about/` | Those photos |
| `messages/*.json` → `about`, `product` | The About and product pages' words, which describe the Cornell Tech lab |
| `src/lib/ai/lab-context.ts` | "Where you are": what the assistant knows about the lab, its building, staff and hours |
| `src/lib/ai/lab-companion.ts` | Who the assistant suggests asking |
| `public/product/` | Screenshots and the walkthrough video of the Cornell site |
| `src/lib/map/studio-101.ts` | The floor plan of Studio 101 ([`map.md`](map.md) has a prompt that traces yours) |

## 4 · Your inventory

The no-configuration database is in memory: anything added to it is gone when the server
restarts. Before entering real equipment, give it somewhere to live, either a local
database that persists (`PGLITE_DATA_DIR=.pglite-data npm run dev`, copied up later with
`npm run data:push`) or a hosted one (`DATABASE_URL`, [`deploy.md`](deploy.md) Part 2).

Then add equipment in `/admin` (paste a list, a product link or a photo of a label; the
app researches each item and leaves a draft to approve), or import an existing Notion
inventory ([`deploy.md`](deploy.md) Stage 2).

## 5 · Check the assistant

`npm run eval:all` runs every agent eval: the chat eval (finding machines, citing the
catalogue, calling the right tool, admitting what the lab lacks), then your manuals'
questions end to end. It makes real, paid calls (a few cents) and needs the Gateway key.
Run it after changing the prompt, the lab description or the model
([`evals/README.md`](../evals/README.md)).

## 6 · Host it

[`deploy.md`](deploy.md) Part 2 walks through a Vercel deployment: Neon Postgres, two
Blob stores, Google sign-in, the variables, and the nightly job. Hosting runs about
$20–40 a month and the AI about $10–15 at one lab's use (`/product`, "What it costs").

## 7 · Keep the source link pointing at your fork

MakerLAB Tools is licensed under the AGPL-3.0. If you change it and let people use it
over a network, you must offer them your version's source
([`LICENSING.md`](../LICENSING.md)). The simplest way is a public fork and a link to it
from your site: set `NEXT_PUBLIC_SOURCE_URL` to your fork's address, and the footer's
**Source code**, `/product`'s **Fork it for your lab** and the About page all point
there.

## Sending changes back

Improvements that would help other labs are welcome as pull requests. Every feature
starts with a spec ([`constitution.md`](constitution.md), Article 1), `npm run test:all`
must pass, and outside contributors sign the [CLA](../CLA.md) once.
