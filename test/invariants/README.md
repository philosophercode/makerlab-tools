# Invariant tests

Twenty rules that must hold whatever the input or code path. Each file states its
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
| 11 | `ssrf-guard` | Any address in a private, loopback, link-local, metadata or multicast range, in any IPv4-inside-IPv6 spelling, is refused; public addresses are not |
| 12 | `rate-limiter` | At most `limit` calls per window, the first `limit` always allowed, and keys never share a budget |
| 13 | `account-rules` | An out-of-domain, banned or unknown-role account never acts; the super admin floor always does; nobody is promoted |
| 14 | `signed-links` | Unsubscribe links and demo pass cookies verify only exactly as signed: no edit, other secret, expired pass or invented string |
| 15 | `csv-export` | A CSV export parses back to exactly its cells, and no cell starts a spreadsheet formula |
| 16 | `prompt-fence` | Untrusted text can't close or fake its fence in a prompt; inline quotes stay one JSON line |
| 17 | `action-gate` | For every registered action, a caller without its permission is refused before any of its steps runs |
| 18 | `input-schemas` | Every assistant tool and action input schema answers any value without throwing, and only lets objects through |
| 19 | `slugs` | Slugs are safe URL segments, idempotent, and unique within a batch |
| 20 | `anonymous-privacy` | An anonymous visitor's rate-limit key is a salted hash, never the raw IP, and stable per address |

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
