/**
 * Standalone checks for lib/rows.js (Supabase backend) — run with:
 *   node scripts/row-shape-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern as
 * the other suites: the package has no "type": "module").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function load(rel) {
  try {
    return await import(rel);
  } catch {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    return import(`data:text/javascript,${encodeURIComponent(src)}`);
  }
}

const R = await load("../lib/rows.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const USER = "00000000-0000-0000-0000-000000000001";

function makeDoc() {
  return {
    id: "file-abc",
    teamId: "team-my-team",
    title: "My Design",
    createdBy: "you",
    updatedAt: "2026-11-05T01:02:03.000Z",
    tokens: [{ id: "tok-1", type: "color", name: "Brand", value: "#fff" }],
    pages: [{ id: "page-1", name: "Page 1", background: "#EEEEEE", rootNodeIds: [] }],
    nodes: {},
    comments: [],
    assets: {},
  };
}

// 1. docToRow maps the fields the schema expects -----------------------------
check("docToRow field mapping", () => {
  const doc = makeDoc();
  const row = R.docToRow(doc, null, USER);
  assert.equal(row.id, "file-abc");
  assert.equal(row.owner_id, USER);
  assert.equal(row.title, "My Design");
  assert.equal(row.updated_at, "2026-11-05T01:02:03.000Z");
  // the whole document rides in the doc column, untouched in substance
  assert.equal(row.doc.title, "My Design");
  assert.deepEqual(row.doc.pages, doc.pages);
  assert.deepEqual(row.doc.tokens, doc.tokens);
});

// 2. docToRow defaults when meta is null; meta wins when present -------------
check("docToRow share/archived/swatch defaults + meta override", () => {
  const row = R.docToRow(makeDoc(), null, USER);
  assert.deepEqual(row.share, { access: "anyone", permission: "edit" });
  assert.equal(row.archived, false);
  assert.equal(row.swatch, R.swatchFor("file-abc"));

  const meta = {
    share: { access: "team", permission: "view" },
    archived: true,
    swatch: "oklch(0.7 0.15 160)",
  };
  const row2 = R.docToRow(makeDoc(), meta, USER);
  assert.deepEqual(row2.share, meta.share);
  assert.equal(row2.archived, true);
  assert.equal(row2.swatch, "oklch(0.7 0.15 160)");
});

// 3. Round-trip: row -> doc/meta agrees with what went in ---------------------
check("rowToDoc / rowToMeta round-trip", () => {
  const row = R.docToRow(
    makeDoc(),
    { share: { access: "team", permission: "edit" }, archived: true, swatch: "sw" },
    USER,
  );
  const doc = R.rowToDoc(row);
  assert.equal(doc.id, "file-abc");
  assert.equal(doc.title, "My Design");
  assert.deepEqual(doc.pages, makeDoc().pages);

  const meta = R.rowToMeta(row);
  assert.deepEqual(meta, {
    id: "file-abc",
    title: "My Design",
    updatedAt: "2026-11-05T01:02:03.000Z",
    archived: true,
    share: { access: "team", permission: "edit" },
    swatch: "sw",
  });
});

// 4. Row columns win over a stale doc title/id --------------------------------
check("rowToDoc lets row columns win", () => {
  const row = R.docToRow(makeDoc(), null, USER);
  row.title = "Renamed on the dashboard";
  const doc = R.rowToDoc(row);
  assert.equal(doc.title, "Renamed on the dashboard");
});

// 5. Sparse docs/rows get their defaults filled --------------------------------
check("normalizeDoc + sparse row defaults", () => {
  // a doc saved before comments/assets existed
  const sparse = makeDoc();
  delete sparse.comments;
  delete sparse.assets;
  delete sparse.tokens;
  const row = R.docToRow(sparse, null, USER);
  assert.deepEqual(row.doc.comments, []);
  assert.deepEqual(row.doc.assets, {});
  assert.deepEqual(row.doc.tokens, []);

  const doc = R.rowToDoc(row);
  assert.deepEqual(doc.comments, []);
  assert.deepEqual(doc.assets, {});

  // a row with null share/swatch still yields a complete meta
  const bareRow = { id: "file-x", title: "X", updated_at: "2026-01-01T00:00:00.000Z" };
  const meta = R.rowToMeta(bareRow);
  assert.deepEqual(meta.share, { access: "anyone", permission: "edit" });
  assert.equal(meta.archived, false);
  assert.equal(meta.swatch, R.swatchFor("file-x"));

  // junk in -> null out, never a throw
  assert.equal(R.rowToDoc(null), null);
  assert.equal(R.rowToDoc({ doc: { nope: true } }), null);
  assert.equal(R.rowToMeta(null), null);
});

// 6. swatchFor is deterministic and stays inside the palette -------------------
check("swatchFor determinism", () => {
  assert.equal(R.swatchFor("file-landing"), R.swatchFor("file-landing"));
  assert.notEqual(R.swatchFor("file-landing"), undefined);
  assert.equal(typeof R.swatchFor("anything"), "string");
});

console.log(`\n${passed} row-shape checks passed`);
