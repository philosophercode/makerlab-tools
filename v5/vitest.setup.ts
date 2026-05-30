import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./test/msw/server";

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

// ── Per-test cleanup ───────────────────────────────────────────────
//
// Undo `vi.stubEnv(...)` and restore any spies/mocks created with
// `vi.spyOn` / `vi.fn` automatically after every test.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
