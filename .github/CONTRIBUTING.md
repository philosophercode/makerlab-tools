# Contributing

Thanks for looking. MakerLAB Tools is the live Cornell Tech MakerLAB app and is open
source so other labs can run and improve it. Bug reports, fixes, translations and
features are all welcome.

## Before you start

- **Running your own copy** is covered in [`docs/fork.md`](../docs/fork.md). You do not
  need to contribute back to use it, but the [AGPL](../docs/legal/LICENSING.md) asks you to offer
  your changed source to the people who use your deployment.
- **The rules every change follows** are in [`docs/constitution.md`](../docs/constitution.md).
  Read it once; it is short.
- **How the code is laid out** is in [`AGENTS.md`](../AGENTS.md) and
  [`docs/architecture/`](../docs/architecture/). They are written for people and AI coding
  assistants alike.

## Setting up

Use **Node 24** (`.nvmrc`). `npm install` works with any recent npm. `npm ci` needs
**npm 11.6.2**, the version the lockfile is written with (CI pins it for the same
reason: `npm install -g npm@11.6.2`).

```bash
npm install
npm run dev                       # http://localhost:3000, demo data, no keys needed
npx playwright install chromium   # once, before the first E2E run
```

## Making a change

1. **Small fixes** (a typo, a broken link, a one-line bug fix, a dependency bump) go
   straight to a pull request.
2. **Anything that adds or changes behaviour starts with a spec.** Copy
   [`docs/specs/TEMPLATE.md`](../docs/specs/TEMPLATE.md) to
   `docs/specs/YYYY-MM-DD-<slug>.md` (or run `/spec` in Claude Code) and open it as its
   own pull request. The implementation pull request opens after the spec merges
   (constitution, Article 1). Opening an issue first to ask whether an idea fits is
   welcome and saves work.
3. **Ship tests with the change**, at the layer it lives in (unit, integration,
   component or E2E). No test may make a network call; [`docs/testing.md`](../docs/testing.md)
   explains the stubs.
4. **User-facing text goes through `next-intl`.** Add the English string to
   `messages/en.json` in the same pull request; other locales fall back to English.
5. **Check before you push:**

   ```bash
   npm run test:all        # lint + typecheck + vitest + playwright; must pass
   npm run spec:coverage   # every route, tool, script and env var is documented
   ```

   Both run with every environment variable unset. The agent evals
   (`npm run eval:all`) make paid model calls and are never required.

## Contributor License Agreement

Outside contributors agree to the [CLA](../docs/legal/CLA.md) once, by commenting on their first pull
request:

```
I have read the CLA in docs/legal/CLA.md and I agree to it.
```

You keep your copyright; the agreement is recorded in
[`docs/legal/cla-signatures.md`](../docs/legal/cla-signatures.md).

## Reporting a security problem

Please do not open a public issue. See [`SECURITY.md`](SECURITY.md).
