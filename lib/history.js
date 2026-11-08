/**
 * Undo history helpers (M3) — pure and import-free, so they run in the
 * browser, in Next's build, and in scripts/history-test.mjs.
 *
 * The store keeps SNAPSHOT history: `past` is a stack of entries
 *   { doc, coalesceKey, ts }
 * where `doc` is a structuredClone of the document BEFORE the mutation the
 * entry represents, and `future` is the redo stack (same entry shape,
 * holding the docs that were undone away from).
 *
 * Coalescing (Phase 3 §14/§20: rapid repeated actions — nudges above all —
 * collapse into ONE undo step in the reference product): when a new commit
 * carries the same non-null coalesceKey as the newest past entry and lands
 * within the coalescing window, no new entry is pushed. The newest entry
 * keeps its original (pre-burst) snapshot and just has its timestamp
 * refreshed, so a continuous burst keeps coalescing while undo still
 * returns to the state before the whole burst.
 */

/** Default coalescing window in ms. */
export const COALESCE_WINDOW_MS = 1000;

/** Maximum number of entries kept on the past stack. */
export const HISTORY_CAP = 100;

/**
 * Should a commit with `key` at time `now` merge into `lastEntry`?
 * True only when there IS a last entry, the key is non-null and equal to
 * the entry's key, and the entry is inside the window.
 */
export function shouldCoalesce(lastEntry, key, now, windowMs = COALESCE_WINDOW_MS) {
  if (!lastEntry || key == null) return false;
  if (lastEntry.coalesceKey !== key) return false;
  return now - lastEntry.ts <= windowMs;
}

/** Build a history entry for a pre-mutation document snapshot. */
export function makeEntry(doc, coalesceKey = null, ts = Date.now()) {
  return { doc, coalesceKey, ts };
}

/**
 * Push `entry` onto a past stack, honouring the cap: the OLDEST entries
 * are dropped first. Returns a new array (the input is not mutated).
 */
export function pushHistory(past, entry, cap = HISTORY_CAP) {
  const next = [...past, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Apply a commit to a whole history state { past, future }:
 * - coalescing commits refresh the newest entry's timestamp in place
 *   (same snapshot) instead of pushing;
 * - any commit (coalesced or not) clears the redo stack — once you do
 *   something new, the undone future is gone.
 * Returns a new history object.
 */
export function applyCommit(history, entry, cap = HISTORY_CAP, windowMs = COALESCE_WINDOW_MS) {
  const last = history.past[history.past.length - 1];
  if (shouldCoalesce(last, entry.coalesceKey, entry.ts, windowMs)) {
    const past = [...history.past];
    past[past.length - 1] = { ...last, ts: entry.ts };
    return { past, future: [] };
  }
  return { past: pushHistory(history.past, entry, cap), future: [] };
}
