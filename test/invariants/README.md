# Invariant tests

Rules that must hold whatever the input or code path. Each file states its
rule at the top; most are property-based ([fast-check](https://fast-check.dev)):
the test generates hundreds of inputs and shrinks any failure to the smallest
counterexample.

| # | File | The rule |
|---|---|---|
| 1 | `permissions` | `can()` fails closed for unknown subjects and permission strings; user ⊆ admin ⊆ super_admin; the demo identity holds at most `tools.add` + two reads, and nothing when read-only |
| 2 | `identity-forgery` | No cookie or header a client sends (garbage, a tampered real session, the wrong signing secret, role-looking headers) yields a role |
| 3 | `admin-routes` | Every `/api/admin/*` handler, discovered by glob, refuses anonymous, student and demo callers with any body or guessed secret, and checks `can()` itself |
| 4 | `database-substrate` | `DATABASE_URL` alone picks Neon; the demo seed never runs against a configured database and has exactly two importers; `PGLITE_DATA_DIR` is refused on deployments |
| 5 | `api-rate-limits` | Every `src/app/api/**/route.ts` calls the rate limiter, or delegates to a listed module that does |
| 6 | `map-placement` | Every zone and station on the shipped plan is reachable; placement never invents a zone or drops a tool; every seeded tool has a location with a room and zone |
| 7 | `user-isolation` | Under any interleaving of people creating and revoking MCP tokens and making illustrations, nobody sees or changes another person's |
| 8 | `serials` | A random whole serial never appears in public catalogue reads, the kiosk feed or anonymous MCP answers; staff do see it |
| 9 | `assistant-tools` | Chat and MCP never offer a tool whose permission the caller lacks, never a write to an anonymous caller or a read-only connection, and tool sets grow up the role ladder |
| 10 | `api-input-fuzz` | Arbitrary bodies and content types to every public POST route answer 4xx (or a deliberate 501/503), never a 500 or a stack trace |

```bash
npm run test:invariants                         # this folder, default case counts
INVARIANT_RUNS=2000 npm run test:invariants     # a deeper local run
```

CI runs them with the rest of Vitest (`npm test`, sharded in `ci.yml`). A
failure prints fast-check's seed and shrunk counterexample.

Not covered here, because CI cannot see it: which Neon database each Vercel
project points at. Production and the demo are separate projects with their
own `DATABASE_URL`; invariant 4 guarantees the code honours that variable and
nothing else.
