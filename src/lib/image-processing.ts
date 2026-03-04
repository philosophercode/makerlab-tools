/**
 * Tracks image processing state in localStorage so it persists
 * across page navigations. When a tool's image is being regenerated
 * or background-removed, the state is saved here and checked on mount.
 */

const STORAGE_KEY = "makerlab-image-processing";
const EXPIRY_MS = 3 * 60 * 1000; // 3 minutes max

interface ProcessingEntry {
  action: "regenerate" | "remove-bg" | "replace-from-url";
  startedAt: number;
}

type ProcessingMap = Record<string, ProcessingEntry>;

function readMap(): ProcessingMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeMap(map: ProcessingMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function setProcessing(
  toolName: string,
  action: "regenerate" | "remove-bg" | "replace-from-url"
) {
  const map = readMap();
  map[toolName] = { action, startedAt: Date.now() };
  writeMap(map);
}

export function clearProcessing(toolName: string) {
  const map = readMap();
  delete map[toolName];
  writeMap(map);
}

export function getProcessing(toolName: string): ProcessingEntry | null {
  const map = readMap();
  const entry = map[toolName];
  if (!entry) return null;

  // Auto-expire stale entries
  if (Date.now() - entry.startedAt > EXPIRY_MS) {
    clearProcessing(toolName);
    return null;
  }

  return entry;
}
