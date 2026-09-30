import { render, screen, userEvent } from "../../test/utils/render";
import { ThemeToggle } from "./ThemeToggle";

// Mirrors the constant in ThemeToggle.tsx.
const STORAGE_KEY = "theme";

/**
 * This environment's `window.localStorage` is a bare object (jsdom's Storage is
 * clobbered by Node's experimental `--localstorage-file`), so getItem/setItem/
 * removeItem are missing. Install a self-contained in-memory Storage shim on
 * `window` for these tests — the component reads `window.localStorage` directly.
 */
function installLocalStorageShim() {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    installLocalStorageShim();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders a labelled toggle button", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", {
      name: "Cycle color theme (system → light → dark)",
    });
    expect(button).toBeInTheDocument();
  });

  it("cycles system → light on first click and persists to localStorage", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    // No data-theme attribute on mount → readChoice() returns "system".
    await user.click(screen.getByRole("button"));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("cycles light → dark and persists the new value", async () => {
    const user = userEvent.setup();
    // Start from the "light" state.
    document.documentElement.setAttribute("data-theme", "light");
    window.localStorage.setItem(STORAGE_KEY, "light");

    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("cycles dark → system, clearing the attribute and the stored value", async () => {
    const user = userEvent.setup();
    document.documentElement.setAttribute("data-theme", "dark");
    window.localStorage.setItem(STORAGE_KEY, "dark");

    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("walks the full system → light → dark → system cycle across clicks", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const button = screen.getByRole("button");

    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light");

    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");

    await user.click(button);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reads the current theme from the documentElement on mount", async () => {
    const user = userEvent.setup();
    // Existing "light" state should advance to "dark" (not back to "light").
    document.documentElement.setAttribute("data-theme", "light");

    render(<ThemeToggle />);
    await user.click(screen.getByRole("button"));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
