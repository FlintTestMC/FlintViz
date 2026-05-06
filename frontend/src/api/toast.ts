import { showToast } from "../components/toastStore";
import type { ApiResult } from "./client";

// Type guard: returns true on success (narrows `result` to its ok variant).
// On failure, shows an error toast prefixed with `prefix` — except for aborts,
// which are silent (caller cancelled, not a real error).
export function toastOnError<T>(
  result: ApiResult<T>,
  prefix: string,
): result is { ok: true; status: number; body: T } {
  if (result.ok) return true;
  if (result.aborted) return false;
  showToast({ kind: "error", message: `${prefix}: ${result.err}` });
  return false;
}
