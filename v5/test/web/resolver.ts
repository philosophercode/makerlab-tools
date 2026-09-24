import { isIP } from "node:net";

/**
 * The DNS stand-in every test runs with (gateway spec §10: no test touches the
 * network, and resolving a name is a network call).
 *
 * `src/lib/web/guarded-fetch.ts` resolves hosts through
 * `globalThis[Symbol.for("makerlab.web.resolveHost")]` when it is a function.
 * `vitest.setup.ts` calls {@link resetResolver} before and after every test, so
 * the default is always in place:
 *
 * - `localhost` → `127.0.0.1` (and so refused, as it should be);
 * - an IP literal → itself (the guard does not resolve those anyway);
 * - every other name → `93.184.216.34`, a public address, so MSW answers it.
 *
 * A test that needs a name to resolve somewhere else — a public host that
 * resolves inward, a host with several addresses — calls
 * {@link setResolvedAddresses}; an empty list makes that name fail to resolve.
 *
 * On `globalThis`, not a module: the workflow project's step bundle has its own
 * copy of guarded-fetch, and a global is what both copies see.
 */

export const RESOLVE_HOST_HOOK = Symbol.for("makerlab.web.resolveHost");
export const DEFAULT_PUBLIC_ADDRESS = "93.184.216.34";

let overrides: Record<string, string[]> = {};

async function resolve(hostname: string): Promise<string[]> {
  const host = hostname.toLowerCase();
  if (Object.hasOwn(overrides, host)) {
    const addresses = overrides[host];
    if (addresses.length === 0) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return [...addresses];
  }
  if (host === "localhost") return ["127.0.0.1"];
  if (isIP(host)) return [host];
  return [DEFAULT_PUBLIC_ADDRESS];
}

/** Point these names at these addresses, on top of the default, until the next reset. */
export function setResolvedAddresses(map: Record<string, string[]>): void {
  for (const [host, addresses] of Object.entries(map)) overrides[host.toLowerCase()] = addresses;
  install();
}

/** Back to the default: every name public, `localhost` loopback. */
export function resetResolver(): void {
  overrides = {};
  install();
}

function install(): void {
  (globalThis as Record<symbol, unknown>)[RESOLVE_HOST_HOOK] = resolve;
}
