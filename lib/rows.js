/**
 * Row mapping (Supabase backend) — pure functions, no imports beyond
 * nothing at all, so the node test scripts can load this file directly
 * (scripts/row-shape-test.mjs).
 *
 * The Supabase `public.files` table (see supabase/schema.sql) stores one
 * row per design file: the whole document lives in the `doc` jsonb
 * column, and the columns the dashboard needs without parsing documents
 * (title / share / archived / swatch / updated_at) are denormalised onto
 * the row. These helpers convert between the three shapes in play:
 *
 *   DesignFile (lib/model.js)  <->  files table row  <->  FileMeta
 *
 * FileMeta is the registry-entry shape the dashboard and the editor's
 * Share popover already use in local mode:
 *   { id, title, updatedAt (ISO), archived, share, swatch }
 */

export const DEFAULT_SHARE = { access: "anyone", permission: "edit" };

export function defaultShare() {
  return { ...DEFAULT_SHARE };
}

const SWATCHES = [
  "oklch(0.62 0.19 256)",
  "oklch(0.7 0.15 160)",
  "oklch(0.68 0.17 45)",
  "oklch(0.65 0.18 320)",
  "oklch(0.72 0.14 90)",
];

/** Deterministic card tint for a file id (same palette as local mode). */
export function swatchFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

/** Fill the optional collections a stored doc must always carry. */
export function normalizeDoc(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const next = { ...doc };
  if (!Array.isArray(next.comments)) next.comments = [];
  if (!next.assets || typeof next.assets !== "object") next.assets = {};
  if (!Array.isArray(next.tokens)) next.tokens = [];
  return next;
}

/**
 * Build a `files` table row from a document plus its metadata.
 *
 * `meta` may be null (first save): share/archived/swatch then fall back
 * to the same defaults local mode uses. `userId` becomes `owner_id` —
 * the column RLS keys on — and is required by the schema (not null).
 */
export function docToRow(doc, meta, userId) {
  const m = meta ?? {};
  const row = {
    id: doc.id,
    owner_id: userId,
    title: doc.title,
    doc: normalizeDoc(doc),
    share: m.share ?? defaultShare(),
    archived: m.archived ?? false,
    swatch: m.swatch ?? swatchFor(doc.id),
    updated_at: doc.updatedAt ?? new Date().toISOString(),
  };
  // M7: version history rides in its own `versions` jsonb column, and
  // ONLY when the caller passes an array. A doc autosave must not
  // clobber stored versions with a stale copy, so remoteSaveFile omits
  // the key entirely (PostgREST upserts leave absent columns alone,
  // and inserts fall back to the column default '[]'); create/duplicate
  // pass the array explicitly.
  if (Array.isArray(m.versions)) row.versions = m.versions;
  return row;
}

/** Extract the document from a `files` row (defaults normalised). */
export function rowToDoc(row) {
  if (!row || typeof row !== "object" || !row.doc) return null;
  const doc = normalizeDoc(row.doc);
  if (!doc.pages || !doc.nodes) return null;
  // The row's own columns win for identity/title (they are what
  // saveFile/updateFileMeta keep current).
  return { ...doc, id: row.id, title: row.title ?? doc.title };
}

/** Extract the FileMeta (registry entry) from a `files` row. */
export function rowToMeta(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    archived: row.archived ?? false,
    share: row.share ?? defaultShare(),
    swatch: row.swatch ?? swatchFor(row.id),
  };
}
