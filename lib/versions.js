/**
 * Version history — pure helpers (M7). Import-free on purpose, like
 * lib/collab.js and lib/rows.js, so scripts/versions-test.mjs can load
 * this file directly under node.
 *
 * DATA MODEL: a file's versions live NEXT TO its document, never inside
 * it (lib/persistence.js stores them with the file record in both
 * backends). A snapshot that contained the versions array would nest
 * versions inside versions inside versions — so makeVersion also
 * strips a `versions` key defensively if one ever appears on a doc.
 *
 * A version is:
 *   { id, name: string | null, auto: boolean,
 *     createdAt: ISO string, authorName: string,
 *     snapshot: <deep copy of the whole DesignFile> }
 *
 * ORDERING INVARIANT: version lists are kept NEWEST FIRST everywhere
 * (index 0 is the most recent). pruneVersions and shouldAutoVersion
 * both rely on it.
 */

/** Hard cap on stored versions per file (auto ones prune first). */
export const MAX_VERSIONS = 30;

/** Minimum age of the newest version before another autosave is taken. */
export const AUTO_INTERVAL_MS = 15 * 60 * 1000;

let versionSeq = 0;

/**
 * Build a version record from a document. The snapshot is a DEEP copy
 * (structuredClone): later edits to the source doc must never leak
 * into a stored version, and restoring a version clones it again, so
 * the stored snapshot is never the live doc object either.
 *
 * `now` is ms since epoch (injectable for tests); createdAt is its ISO
 * form. A blank/whitespace name normalises to null — display titles
 * come from versionTitle's fallbacks.
 */
export function makeVersion(doc, opts = {}) {
  const { name = null, authorName = "You", auto = false } = opts;
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const snapshot = doc && typeof doc === "object" ? structuredClone(doc) : {};
  delete snapshot.versions;
  const trimmed = typeof name === "string" ? name.trim() : "";
  versionSeq += 1;
  return {
    id: `ver-${now.toString(36)}-${versionSeq.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,
    name: trimmed ? trimmed : null,
    auto: !!auto,
    createdAt: new Date(now).toISOString(),
    authorName:
      typeof authorName === "string" && authorName.trim()
        ? authorName
        : "You",
    snapshot,
  };
}

/**
 * Enforce MAX_VERSIONS on a newest-first list, in the spec's prune
 * order: the OLDEST AUTO versions go first; only when no autos remain
 * to drop are the oldest versions overall dropped (named versions are
 * dropped last). Returns a new array; the input is not mutated.
 */
export function pruneVersions(versions, max = MAX_VERSIONS) {
  if (!Array.isArray(versions)) return [];
  if (versions.length <= max) return [...versions];
  const result = [...versions];
  // Phase 1: scan from the end (oldest) dropping autos.
  for (let i = result.length - 1; i >= 0 && result.length > max; i--) {
    if (result[i]?.auto) result.splice(i, 1);
  }
  // Phase 2: still over the cap → drop oldest overall.
  while (result.length > max) result.pop();
  return result;
}

/**
 * Should an automatic version be taken now? True when the file has no
 * versions yet (the first edit establishes a baseline) or when the
 * NEWEST version is at least AUTO_INTERVAL_MS old. Exactly at the
 * interval counts as due; 1 ms under does not. An unparseable newest
 * timestamp is treated as due (better a spare snapshot than none).
 */
export function shouldAutoVersion(versions, now = Date.now()) {
  if (!Array.isArray(versions) || versions.length === 0) return true;
  const t = Date.parse(versions[0]?.createdAt ?? "");
  if (Number.isNaN(t)) return true;
  return now - t >= AUTO_INTERVAL_MS;
}

/** { pages, nodes } counts for a version's snapshot (panel row meta). */
export function summarizeVersion(version) {
  const snap = version?.snapshot;
  return {
    pages: Array.isArray(snap?.pages) ? snap.pages.length : 0,
    nodes:
      snap?.nodes && typeof snap.nodes === "object"
        ? Object.keys(snap.nodes).length
        : 0,
  };
}

/**
 * Display title: the user's name when present; otherwise "Autosave"
 * for automatic versions and "Unnamed version" for manual ones saved
 * without a name. (The pre-restore safety version is auto BUT named
 * "Before restore", so it shows its name.)
 */
export function versionTitle(version) {
  if (version?.name) return version.name;
  return version?.auto ? "Autosave" : "Unnamed version";
}
