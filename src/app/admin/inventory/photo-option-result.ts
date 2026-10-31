import type { AdminGateError } from "../../../lib/admin/action-result";
import type { PhotoSearchView } from "../../../lib/photo-options/types";

/**
 * What the photo options actions answer (photo options spec 2026-10-29). A
 * directive-free module, because the panel and the server actions both import
 * it (`tool-editor-actions.ts` explains why).
 */

export type FindPhotoOptionsError =
  | AdminGateError
  | "invalid_field"
  | "not_found"
  | "photo_search_running"
  | "daily_limit"
  | "start_failed";

export type FindPhotoOptionsResult =
  | { ok: true; searchId: string }
  | { ok: false; error: FindPhotoOptionsError; remaining?: number };

export type LoadPhotoOptionsResult =
  | { ok: true; search: PhotoSearchView | null }
  | { ok: false; error: AdminGateError | "not_found" };
