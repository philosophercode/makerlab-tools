# Fork it for your lab

> MakerLAB Tools was built for the Cornell Tech MakerLAB, but nothing in it is specific to
> one lab that one config file cannot change. This page
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

## 2 · Make it your lab's: one file

Everything that makes this deployment the Cornell Tech MakerLAB's lives in
[`lab/lab.config.ts`](../lab/lab.config.ts): the names, logo, colours, hours, who may sign
in, the people and links on About, what the assistant knows about the lab, and whether
there is a floor map. Every field has a comment; [`lab/README.md`](../lab/README.md) is the
five-minute tour.

1. Edit `lab/lab.config.ts`. The shipped file is the worked example: replace its values.
2. Put your logo (an SVG and its PNG twin), wordmark and photos in `public/lab/`.
3. Floor plan: trace yours into `lab/floor-plan.json` ([`map.md`](map.md) has the prompt
   that has an AI do it), or set `map: false`.
4. `npm run lab:check`: it validates the file and the plan, checks every image exists,
   and prints what the header, About and the assistant will say.
5. `npm run dev`, then `npm run test:all`.

An invalid file stops `npm run dev` and the build with every bad field named.

**Keep secrets out of it.** The file is committed, and parts of it reach the browser. API
keys, and the individual sign-in addresses (`AUTH_ALLOWED_EMAILS`,
`AUTH_SUPER_ADMIN_EMAILS`), stay in environment variables; `lab:check` refuses a field
that looks like a key.

### Environment variables still win

Each field below keeps its environment variable, which overrides the file when set, so
one checkout can serve several deployments (a demo and the real lab, say):

| Variable | Field |
|---|---|
| `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_INSTITUTION`, `NEXT_PUBLIC_TAGLINE` | `identity.siteName`, `identity.institution`, `identity.tagline` |
| `NEXT_PUBLIC_CHAT_ASSISTANT_NAME`, `AUDIENCE` | `identity.assistantName`, `identity.audience` |
| `NEXT_PUBLIC_LOGO`, `NEXT_PUBLIC_WORDMARK` | `brand.logo`, `brand.wordmark` |
| `NEXT_PUBLIC_COLOR_PRIMARY`, `NEXT_PUBLIC_COLOR_PRIMARY_DARK` | `brand.colors` |
| `NEXT_PUBLIC_SITE_URL` | `web.siteUrl` |
| `NEXT_PUBLIC_SOURCE_URL` | `web.sourceUrl` |
| `NEXT_PUBLIC_LAB_HOURS`, `LAB_TIMEZONE` | `place.hours`, `place.timezone` |
| `AUTH_ALLOWED_EMAIL_DOMAIN` | `access.emailDomain` |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | `email.from`, `email.replyTo` |
| `DEMO_PASS_CONTACT_EMAIL` | `contact.demoEmail` |

## 3 · What else is Cornell's

The licence covers the code, not Cornell's names, logos or photos
([`LICENSING.md`](legal/LICENSING.md)). The config holds almost all of them. Outside it:

| Where | What is there now |
|---|---|
| `public/brand/` | Old copies of the logo, kept one release for printed QR sheets; delete them in a fork |
| `public/product/` | Screenshots and the walkthrough video of the Cornell site (`/product`; turn it off with `pages.product: false`) |
| `messages/*.json` → `about.creditsBody`, `product.credits` | The original author's credit, which names the software's history |

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
([`LICENSING.md`](legal/LICENSING.md)). The simplest way is a public fork and a link to it
from your site: set `web.sourceUrl` in `lab/lab.config.ts` to your fork's address, and the footer's
**Source code**, `/product`'s **Fork it for your lab** and the About page all point
there.

## Sending changes back

Improvements that would help other labs are welcome as pull requests. Every feature
starts with a spec ([`constitution.md`](constitution.md), Article 1), `npm run test:all`
must pass, and outside contributors sign the [CLA](legal/CLA.md) once.
