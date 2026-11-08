/**
 * File persistence — API-shaped, dual backend (local / Supabase).
 *
 * Every exported function is async and mirrors the files API surface
 * (list / load / save / create / duplicate / updateMeta), in two modes:
 *
 * LOCAL MODE (default; no Supabase env vars — see lib/supabase.js):
 *   localStorage-backed, exactly the M3 behaviour. A registry holds the
 *   metadata the dashboard needs without parsing every document:
 *     canvastool:files        registry: FileMeta[]
 *     canvastool:file:<id>    one file record per file: { doc, versions }
 *                             (M7: versions live BESIDE the doc, never
 *                             inside it — snapshots must not nest.
 *                             Pre-M7 records are the bare doc JSON and
 *                             still read fine; they migrate on save.)
 *
 * CONFIGURED MODE (NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY set):
 *   The `public.files` table in Supabase (supabase/schema.sql): one row
 *   per file owned by the signed-in user (RLS: owner-only), the whole
 *   document in the row's `doc` jsonb column and its version history
 *   in the `versions` jsonb column. The registry is derived from the
 *   rows; lib/rows.js converts between row/doc/meta shapes.
 *   First login with zero files seeds the three sample files as rows.
 *
 * FileMeta = { id, title, updatedAt (ISO), archived: boolean,
 *              share: { access: "anyone" | "team",
 *                       permission: "edit" | "view" },
 *              swatch: CSS colour for the dashboard card preview }
 *
 * There is deliberately NO delete: the spec has Archive, no Trash.
 * All functions are client-only and must be called from
 * effects/handlers, never during render. `createBlankDoc` is the one
 * synchronous export — it is a pure document factory.
 */
import { sampleDoc, sampleFiles } from "./sample-doc";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { defaultShare, docToRow, rowToDoc, rowToMeta, swatchFor } from "./rows";

const REGISTRY_KEY = "canvastool:files";
const docKey = (id) => `canvastool:file:${id}`;

const configured = () => isSupabaseConfigured();

function newFileId() {
  return `file-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

// ===========================================================================
// Shared document factories (pure)
// ===========================================================================

/** A minimal valid DesignFile: one empty page, no nodes, no tokens. */
export function createBlankDoc(id, title) {
  return {
    id,
    teamId: "team-my-team",
    title,
    createdBy: "you",
    updatedAt: new Date().toISOString(),
    tokens: [],
    pages: [
      { id: "page-1", name: "Page 1", background: "#EEEEEE", rootNodeIds: [] },
    ],
    nodes: {},
    comments: [],
    assets: {},
  };
}

/** A blank doc seeded with one frame + headline, for the sample files. */
function starterDoc(id, title) {
  const doc = createBlankDoc(id, title);
  doc.nodes = {
    "frame-main": {
      id: "frame-main",
      type: "frame",
      name: "Main frame",
      parentId: null,
      childIds: ["text-title"],
      layout: { mode: "freeform" },
      position: { x: 96, y: 72 },
      size: { w: { kind: "fixed", px: 480 }, h: { kind: "fixed", px: 320 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 8 },
    },
    "text-title": {
      id: "text-title",
      type: "text",
      name: "Title",
      parentId: "frame-main",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 40, y: 40 },
      size: { w: { kind: "fixed", px: 360 }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#1F1F1F" } },
      text: { content: title, fontSize: 24, fontWeight: 600, lineHeight: 1.25 },
    },
  };
  doc.pages[0].rootNodeIds = ["frame-main"];
  return doc;
}

/** The document a sample file is seeded with. */
function sampleSeedDoc(f) {
  if (f.id === "file-scratchpad" || f.isScratchpad) {
    return createBlankDoc(f.id, "Scratchpad");
  }
  if (f.id === sampleDoc.id) {
    return { ...structuredClone(sampleDoc), comments: [] };
  }
  if (f.id === "file-welcome") {
    const doc = createBlankDoc(f.id, "Welcome to Paper");
    doc.pages[0].background = "#5E5E62";
    doc.nodes = {
      "frame-phone": {
        id: "frame-phone",
        type: "frame",
        name: "Welcome Screen",
        parentId: null,
        childIds: ["badge-icon", "text-welcome-h1", "text-welcome-sub", "btn-get-started"],
        layout: { mode: "freeform" },
        position: { x: 80, y: 40 },
        size: { w: { kind: "fixed", px: 320 }, h: { kind: "fixed", px: 560 } },
        style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 28 },
      },
      "badge-icon": {
        id: "badge-icon",
        type: "rect",
        name: "Badge",
        parentId: "frame-phone",
        childIds: [],
        position: { x: 28, y: 36 },
        size: { w: { kind: "fixed", px: 44 }, h: { kind: "fixed", px: 44 } },
        style: { fill: { kind: "solid", color: "#0D99FF" }, radius: 12 },
      },
      "text-welcome-h1": {
        id: "text-welcome-h1",
        type: "text",
        name: "Headline",
        parentId: "frame-phone",
        childIds: [],
        position: { x: 28, y: 100 },
        size: { w: { kind: "fixed", px: 260 }, h: { kind: "fit" } },
        style: { fill: { kind: "solid", color: "#18181B" } },
        text: { content: "Welcome to Paper", fontSize: 24, fontWeight: 700, lineHeight: 1.2 },
      },
      "text-welcome-sub": {
        id: "text-welcome-sub",
        type: "text",
        name: "Description",
        parentId: "frame-phone",
        childIds: [],
        position: { x: 28, y: 140 },
        size: { w: { kind: "fixed", px: 260 }, h: { kind: "fit" } },
        style: { fill: { kind: "solid", color: "#71717A" } },
        text: { content: "A next-generation vector design environment crafted for precision and flow.", fontSize: 13, fontWeight: 400, lineHeight: 1.4 },
      },
      "btn-get-started": {
        id: "btn-get-started",
        type: "frame",
        name: "Start Button",
        parentId: "frame-phone",
        childIds: ["text-btn"],
        position: { x: 28, y: 480 },
        size: { w: { kind: "fixed", px: 264 }, h: { kind: "fixed", px: 44 } },
        style: { fill: { kind: "solid", color: "#18181B" }, radius: 10 },
      },
      "text-btn": {
        id: "text-btn",
        type: "text",
        name: "Button Text",
        parentId: "btn-get-started",
        childIds: [],
        position: { x: 80, y: 14 },
        size: { w: { kind: "fit" }, h: { kind: "fit" } },
        style: { fill: { kind: "solid", color: "#FFFFFF" } },
        text: { content: "Get Started", fontSize: 13, fontWeight: 600 },
      },
    };
    doc.pages[0].rootNodeIds = ["frame-phone"];
    return doc;
  }
  if (f.id === "file-liquid-metal") {
    const doc = createBlankDoc(f.id, "Liquid Metal Playground");
    doc.pages[0].background = "#141416";
    doc.nodes = {
      "frame-metal": {
        id: "frame-metal",
        type: "frame",
        name: "Liquid Canvas",
        parentId: null,
        childIds: ["rect-shader"],
        layout: { mode: "freeform" },
        position: { x: 60, y: 40 },
        size: { w: { kind: "fixed", px: 520 }, h: { kind: "fixed", px: 360 } },
        style: { fill: { kind: "solid", color: "#1E1E22" }, radius: 16 },
      },
      "rect-shader": {
        id: "rect-shader",
        type: "rect",
        name: "Fluid Metal Mirror",
        parentId: "frame-metal",
        childIds: [],
        position: { x: 60, y: 40 },
        size: { w: { kind: "fixed", px: 400 }, h: { kind: "fixed", px: 280 } },
        style: {
          fill: {
            kind: "linear",
            gradient: "linear-gradient(135deg, #fce043 0%, #fb7ba2 30%, #4facfe 70%, #00f2fe 100%)",
          },
          radius: 12,
        },
      },
    };
    doc.pages[0].rootNodeIds = ["frame-metal"];
    return doc;
  }
  return starterDoc(f.id, f.title);
}

// ===========================================================================
// LOCAL backend (localStorage) — the M3 implementation, unchanged semantics
// ===========================================================================

function readRegistry() {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeRegistry(files) {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(files));
}

/**
 * Read one file record. The M7 shape is { doc, versions }; pre-M7
 * records stored the bare document under the same key, so anything
 * without a `doc` object is treated as a legacy bare doc with an
 * empty version list (and is rewritten in the new shape on next save).
 */
function readRecord(id) {
  try {
    const raw = localStorage.getItem(docKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.doc && typeof parsed.doc === "object") {
      return {
        doc: parsed.doc,
        versions: Array.isArray(parsed.versions) ? parsed.versions : [],
      };
    }
    return { doc: parsed, versions: [] };
  } catch {
    return null;
  }
}

function writeRecord(id, doc, versions) {
  localStorage.setItem(
    docKey(id),
    JSON.stringify({ doc, versions: Array.isArray(versions) ? versions : [] }),
  );
}

function localEnsureSeeded() {
  const existing = readRegistry();
  if (!existing || existing.length === 0) {
    const files = sampleFiles.map((f, i) => ({
      id: f.id,
      title: f.title,
      updatedAt: new Date(Date.now() - i * 3600000).toISOString(),
      archived: false,
      share: defaultShare(),
      swatch: f.swatch,
      isScratchpad: Boolean(f.isScratchpad),
      subtitle: f.editedLabel,
    }));
    writeRegistry(files);
    for (const f of sampleFiles) {
      const has = localStorage.getItem(docKey(f.id));
      if (!has) writeRecord(f.id, sampleSeedDoc(f), []);
    }
  } else {
    let changed = false;
    const files = [...existing];
    sampleFiles.forEach((f, i) => {
      if (!files.some((ex) => ex.id === f.id)) {
        files.push({
          id: f.id,
          title: f.title,
          updatedAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
          archived: false,
          share: defaultShare(),
          swatch: f.swatch,
          isScratchpad: Boolean(f.isScratchpad),
          subtitle: f.editedLabel,
        });
        const has = localStorage.getItem(docKey(f.id));
        if (!has) writeRecord(f.id, sampleSeedDoc(f), []);
        changed = true;
      }
    });
    if (changed) {
      writeRegistry(files);
    }
  }
}

function localListFiles() {
  return [...(readRegistry() ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function localLoadFileMeta(id) {
  return (readRegistry() ?? []).find((f) => f.id === id) ?? null;
}

function localLoadFile(id) {
  const record = readRecord(id);
  const doc = record?.doc;
  if (!doc || typeof doc !== "object" || !doc.pages || !doc.nodes) {
    return null;
  }
  if (!Array.isArray(doc.comments)) doc.comments = [];
  if (!doc.assets || typeof doc.assets !== "object") doc.assets = {};
  return doc;
}

/** The file's version history (newest first), [] when none/unreadable. */
function localLoadVersions(id) {
  return readRecord(id)?.versions ?? [];
}

function localSaveFile(id, doc) {
  const toStore = { ...doc, id, updatedAt: new Date().toISOString() };
  // Preserve the record's versions across a doc save (they are saved
  // through their own path, below).
  writeRecord(id, toStore, readRecord(id)?.versions ?? []);
  const files = readRegistry() ?? [];
  const entry = files.find((f) => f.id === id);
  if (entry) {
    entry.title = doc.title;
    entry.updatedAt = toStore.updatedAt;
    if (doc.thumbnail) entry.thumbnail = doc.thumbnail;
  } else {
    files.push({
      id,
      title: doc.title,
      updatedAt: toStore.updatedAt,
      archived: false,
      share: defaultShare(),
      swatch: swatchFor(id),
      thumbnail: doc.thumbnail || null,
    });
  }
  writeRegistry(files);
}

/** Persist ONLY the version list, leaving the stored doc untouched. */
function localSaveVersions(id, versions) {
  const record = readRecord(id);
  if (!record?.doc) return;
  writeRecord(id, record.doc, versions);
}

function localCreateFile(title = "Untitled") {
  localEnsureSeeded();
  const id = newFileId();
  const doc = createBlankDoc(id, title);
  const files = readRegistry() ?? [];
  const meta = {
    id,
    title,
    updatedAt: doc.updatedAt,
    archived: false,
    share: defaultShare(),
    swatch: swatchFor(id),
  };
  files.push(meta);
  writeRegistry(files);
  writeRecord(id, doc, []);
  return meta;
}

function localDuplicateFile(id) {
  const source = localLoadFileMeta(id);
  const doc = localLoadFile(id);
  if (!source || !doc) return null;
  const meta = localCreateFile(`${source.title} copy`);
  const copy = { ...doc, id: meta.id, title: meta.title };
  // M7: the copy inherits the source's version history too.
  writeRecord(meta.id, copy, localLoadVersions(id));
  const files = readRegistry() ?? [];
  const entry = files.find((f) => f.id === meta.id);
  if (entry) entry.swatch = source.swatch;
  writeRegistry(files);
  return meta;
}

function localUpdateFileMeta(id, patch) {
  const files = readRegistry() ?? [];
  const entry = files.find((f) => f.id === id);
  if (!entry) return null;
  Object.assign(entry, patch);
  writeRegistry(files);
  return entry;
}

// ===========================================================================
// REMOTE backend (Supabase `files` table) — owner-scoped by RLS
// ===========================================================================

const META_COLUMNS = "id, title, share, archived, swatch, updated_at";

async function currentUserId() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.user?.id ?? null;
}

/** First-login seeding: a user with zero files gets the sample files. */
async function seedRemoteIfEmpty(userId) {
  const sb = getSupabase();
  const { count, error } = await sb
    .from("files")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (error) {
    console.error("canvas-tool: seed check failed", error);
    return;
  }
  if ((count ?? 0) > 0) return;
  const now = new Date().toISOString();
  const rows = sampleFiles.map((f) => {
    const doc = sampleSeedDoc(f);
    doc.updatedAt = now;
    return docToRow(
      doc,
      { share: defaultShare(), archived: false, swatch: f.swatch },
      userId,
    );
  });
  const { error: insertError } = await sb.from("files").insert(rows);
  if (insertError) console.error("canvas-tool: seed insert failed", insertError);
}

async function remoteListFiles() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("files")
    .select(META_COLUMNS)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("canvas-tool: listFiles failed", error);
    return [];
  }
  return (data ?? []).map(rowToMeta);
}

async function remoteLoadFileMeta(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("files")
    .select(META_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("canvas-tool: loadFileMeta failed", error);
    return null;
  }
  return data ? rowToMeta(data) : null;
}

async function remoteLoadFile(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("files")
    .select("id, title, doc")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("canvas-tool: loadFile failed", error);
    return null;
  }
  return data ? rowToDoc(data) : null;
}

async function remoteSaveFile(id, doc) {
  const sb = getSupabase();
  const userId = await currentUserId();
  if (!userId) return;
  // Preserve the row's share/archived/swatch across a doc save. The
  // meta from rowToMeta deliberately carries NO versions, so the
  // upsert payload has no `versions` key and the stored history is
  // left untouched (versions persist via saveVersions only).
  const meta = await remoteLoadFileMeta(id);
  const row = docToRow(
    { ...doc, id, updatedAt: new Date().toISOString() },
    meta,
    userId,
  );
  const { error } = await sb.from("files").upsert(row, { onConflict: "id" });
  if (error) console.error("canvas-tool: saveFile failed", error);
}

/** The file's version history from the `versions` jsonb column. */
async function remoteLoadVersions(id) {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("files")
    .select("versions")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("canvas-tool: loadVersions failed", error);
    return [];
  }
  return Array.isArray(data?.versions) ? data.versions : [];
}

/** Persist ONLY the version list (single-column update). */
async function remoteSaveVersions(id, versions) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("files")
    .update({ versions: Array.isArray(versions) ? versions : [] })
    .eq("id", id);
  if (error) console.error("canvas-tool: saveVersions failed", error);
}

async function remoteCreateFromDoc(title, doc, swatch, versions = null) {
  const sb = getSupabase();
  const userId = await currentUserId();
  if (!userId) return null;
  const id = newFileId();
  const row = docToRow(
    { ...doc, id, title, updatedAt: new Date().toISOString() },
    {
      share: defaultShare(),
      archived: false,
      swatch: swatch ?? swatchFor(id),
      // M7: a duplicate carries its history; a fresh file passes null
      // and the row insert falls back to the column default '[]'.
      ...(Array.isArray(versions) ? { versions } : {}),
    },
    userId,
  );
  const { error } = await sb.from("files").insert(row);
  if (error) {
    console.error("canvas-tool: createFile failed", error);
    return null;
  }
  return rowToMeta(row);
}

async function remoteUpdateFileMeta(id, patch) {
  const sb = getSupabase();
  const updates = {};
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.archived !== undefined) updates.archived = patch.archived;
  if (patch.share !== undefined) updates.share = patch.share;
  if (patch.swatch !== undefined) updates.swatch = patch.swatch;
  if (Object.keys(updates).length === 0) return remoteLoadFileMeta(id);
  const { data, error } = await sb
    .from("files")
    .update(updates)
    .eq("id", id)
    .select(META_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("canvas-tool: updateFileMeta failed", error);
    return null;
  }
  return data ? rowToMeta(data) : null;
}

// ===========================================================================
// Public API (all async; same names/semantics in both modes)
// ===========================================================================

/**
 * First-run seeding: locally, create the registry + sample docs if
 * absent; remotely, seed the sample files for a first-login user who
 * has none. Safe to call repeatedly.
 */
export async function ensureSeeded() {
  if (configured()) {
    // Configured mode uses 100% dynamic data from Supabase (no mock files)
    return;
  }
  localEnsureSeeded();
}

/** All file entries (active and archived), newest-edited first. */
export async function listFiles() {
  if (configured()) return remoteListFiles();
  const local = localListFiles();
  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/files", { cache: "no-store" });
      if (res.ok) {
        const { files } = await res.json();
        if (Array.isArray(files) && files.length > 0) {
          const registry = readRegistry() ?? [];
          let changed = false;
          files.forEach((remoteFile) => {
            const idx = registry.findIndex((f) => f.id === remoteFile.id);
            if (idx === -1) {
              registry.unshift(remoteFile);
              changed = true;
            }
          });
          if (changed) {
            writeRegistry(registry);
            return localListFiles();
          }
        }
      }
    } catch (_) {}
  }
  return local;
}

/** One file entry, or null. */
export async function loadFileMeta(id) {
  if (configured()) return remoteLoadFileMeta(id);
  const meta = localLoadFileMeta(id);
  if (!meta && typeof window !== "undefined") {
    try {
      const res = await fetch(`/api/files/${id}`, { cache: "no-store" });
      if (res.ok) {
        const doc = await res.json();
        if (doc && doc.id) {
          localSaveFile(id, doc);
          return localLoadFileMeta(id);
        }
      }
    } catch (_) {}
  }
  return meta;
}

/** The stored document for `id`, or null when nothing is stored. */
export async function loadFile(id) {
  if (configured()) return remoteLoadFile(id);
  let doc = localLoadFile(id);
  if (typeof window !== "undefined") {
    // Only pull from server if local has no doc, or if local is a blank placeholder
    // while the server file has nodes created via MCP
    const localEmpty =
      !doc ||
      (Object.keys(doc.nodes || {}).length === 0 && (!doc.pages || doc.pages.length <= 1));
    if (localEmpty) {
      try {
        const res = await fetch(`/api/files/${id}`, { cache: "no-store" });
        if (res.ok) {
          const remoteDoc = await res.json();
          if (remoteDoc && remoteDoc.id && remoteDoc.pages) {
            doc = remoteDoc;
            localSaveFile(id, remoteDoc);
          }
        }
      } catch (_) {}
    }
  }
  return doc;
}

/**
 * Persist a document and refresh its metadata (title follows the
 * document; updatedAt bumps). Creates the file entry when missing.
 * Never touches the file's version history.
 */
export async function saveFile(id, doc) {
  if (configured()) return remoteSaveFile(id, doc);
  localSaveFile(id, doc);
  if (typeof window !== "undefined") {
    try {
      await fetch(`/api/files/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
    } catch (_) {}
  }
}

/** The file's version history (M7), newest first; [] when none. */
export async function loadVersions(id) {
  return configured() ? remoteLoadVersions(id) : localLoadVersions(id);
}

/** Persist the file's version history (M7), leaving the doc untouched. */
export async function saveVersions(id, versions) {
  if (configured()) return remoteSaveVersions(id, versions);
  localSaveVersions(id, versions);
}

/** Create a new blank file; returns its registry entry (or null). */
export async function createFile(title = "Untitled") {
  if (configured()) {
    return remoteCreateFromDoc(title, createBlankDoc(newFileId(), title), null);
  }
  return localCreateFile(title);
}

/** Copy a file's document under a fresh id; returns the new entry. */
export async function duplicateFile(id) {
  if (configured()) {
    const meta = await remoteLoadFileMeta(id);
    const doc = await remoteLoadFile(id);
    if (!meta || !doc) return null;
    const versions = await remoteLoadVersions(id);
    return remoteCreateFromDoc(`${meta.title} copy`, doc, meta.swatch, versions);
  }
  return localDuplicateFile(id);
}

/** Patch a file entry (rename / archive / share settings). */
export async function updateFileMeta(id, patch) {
  return configured()
    ? remoteUpdateFileMeta(id, patch)
    : localUpdateFileMeta(id, patch);
}
