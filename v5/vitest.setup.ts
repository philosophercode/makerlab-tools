import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./test/msw/server";
import { resetResolver } from "./test/web/resolver";

// ── Blob: "none" unless a test opts in ─────────────────────────────
//
// Outside Vercel, no `BLOB_READ_WRITE_TOKEN` means the `.blob-data/` folder
// (src/lib/blob-mode.ts). Tests keep the old meaning — no token, no store — so
// the `blob_not_configured` branches stay covered and no test writes to the
// working tree. A local-mode test stubs this to "" and points the store at a
// temporary folder. Set directly (not `vi.stubEnv`) so `unstubAllEnvs` after
// each test restores it rather than removing it.
process.env.BLOB_LOCAL_DISABLE ??= "1";

// ── Database: the demo seed unless a test opts in ─────────────────
//
// `PGLITE_DATA_DIR` in a developer's shell would turn every "DATABASE_URL
// unset" test into one against their persistent local database. Tests that
// want it stub a temporary folder.
process.env.PGLITE_DATA_DIR = "";

// ── Web Storage shim ───────────────────────────────────────────────
//
// Under this Node/jsdom combo `window.localStorage` is a bare object missing
// getItem/setItem/removeItem/clear (Node's experimental `--localstorage-file`
// clobbers jsdom's Storage — hence the startup warning). Any component that
// touches localStorage (ThemeToggle, etc.) would throw. Install a real
// in-memory Storage so the whole suite has working localStorage/sessionStorage,
// and reset it before each test for isolation.
function createStorage(): Storage {
  let map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map = new Map();
    },
  } as Storage;
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (!current || typeof current.setItem !== "function") {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: createStorage(),
    });
  }
}

beforeEach(() => {
  ensureStorage("localStorage");
  ensureStorage("sessionStorage");
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

// ── MSW lifecycle ──────────────────────────────────────────────────
//
// `onUnhandledRequest: "error"` makes any un-mocked outbound HTTP call fail
// loudly — tests must never hit the real network. If a specific test
// legitimately needs to relax this (e.g. it asserts a fetch rejects), pass a
// per-call override via `server.listen(...)` inside that test, or register a
// passthrough/override handler with `server.use(...)`.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

// Drop per-test `server.use(...)` overrides so tests stay isolated.
afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// ── DNS: a stand-in resolver, never the network ────────────────────
//
// The server-side page reader (src/lib/web/guarded-fetch.ts) resolves a host
// before it fetches, to refuse private addresses. Resolving is a network call,
// so every test gets test/web/resolver.ts's default instead — any name is a
// public address MSW then answers, `localhost` is loopback. It lives on
// `globalThis`, which is what lets the workflow project's step bundle see it.
// A test that needs another answer calls `setResolvedAddresses(...)`; the
// reset after each test drops it.
beforeEach(() => {
  resetResolver();
});

afterEach(() => {
  resetResolver();
});

// ── Per-test cleanup ───────────────────────────────────────────────
//
// Undo `vi.stubEnv(...)` and restore any spies/mocks created with
// `vi.spyOn` / `vi.fn` automatically after every test.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
