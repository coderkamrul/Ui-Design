/**
 * Standalone checks for lib/versions.js (M7 version history) — run
 * with: node scripts/versions-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern
 * as the other suites: the package has no "type": "module").
 * versions.js is import-free precisely so this works.
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

const V = await load("../lib/versions.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function makeDoc() {
  return {
    id: "file-abc",
    title: "My Design",
    tokens: [],
    pages: [
      { id: "page-1", name: "Page 1", background: "#EEEEEE", rootNodeIds: ["n1"] },
      { id: "page-2", name: "Page 2", background: "#EEEEEE", rootNodeIds: [] },
    ],
    nodes: {
      n1: { id: "n1", type: "frame", name: "Frame", childIds: ["n2"] },
      n2: { id: "n2", type: "rect", name: "Rect", childIds: [] },
      n3: { id: "n3", type: "text", name: "Text", childIds: [] },
    },
    comments: [],
    assets: {},
  };
}

const T0 = Date.parse("2026-11-05T00:00:00.000Z");
const stub = (over) => ({
  id: "ver-x",
  name: null,
  auto: false,
  createdAt: new Date(T0).toISOString(),
  authorName: "You",
  snapshot: {},
  ...over,
});

// 1. makeVersion shape -------------------------------------------------------
check("makeVersion produces the full version record", () => {
  const v = V.makeVersion(makeDoc(), {
    name: "  Launch candidate  ",
    authorName: "Md",
    auto: false,
    now: T0,
  });
  assert.equal(typeof v.id, "string");
  assert.ok(v.id.length > 0);
  assert.equal(v.name, "Launch candidate", "names are trimmed");
  assert.equal(v.auto, false);
  assert.equal(v.createdAt, "2026-11-05T00:00:00.000Z");
  assert.equal(v.authorName, "Md");
  assert.deepEqual(v.snapshot, makeDoc());

  // Defaults: blank name → null, author → "You", auto coerced boolean.
  const d = V.makeVersion(makeDoc(), { name: "   ", now: T0 });
  assert.equal(d.name, null);
  assert.equal(d.authorName, "You");
  assert.equal(d.auto, false);
  assert.notEqual(d.id, v.id, "ids are unique per version");
});

// 2. Snapshot is a deep copy, and never carries a versions key ----------------
check("makeVersion snapshot is isolated from the source doc", () => {
  const doc = makeDoc();
  doc.versions = [{ id: "nested-should-not-survive" }]; // aberrant input
  const v = V.makeVersion(doc, { now: T0 });
  assert.ok(!("versions" in v.snapshot), "snapshots never nest versions");

  // Mutating the source afterwards must not leak into the snapshot.
  doc.nodes.n1.name = "Renamed after the fact";
  doc.nodes.n2.childIds.push("ghost");
  doc.pages.push({ id: "page-3", name: "Late page", rootNodeIds: [] });
  delete doc.nodes.n3;
  assert.equal(v.snapshot.nodes.n1.name, "Frame");
  assert.deepEqual(v.snapshot.nodes.n2.childIds, []);
  assert.equal(v.snapshot.pages.length, 2);
  assert.ok(v.snapshot.nodes.n3, "deleted source node survives in snapshot");

  // …and mutating the snapshot must not leak back into the source.
  v.snapshot.nodes.n1.name = "Snapshot edit";
  assert.equal(doc.nodes.n1.name, "Renamed after the fact");
});

// 3. pruneVersions: cap + prune order ------------------------------------------
check("pruneVersions respects the cap and drops autos before named", () => {
  assert.equal(V.MAX_VERSIONS, 30);

  // Under the cap: untouched contents.
  const few = [stub({ id: "a" }), stub({ id: "b", auto: true })];
  assert.deepEqual(V.pruneVersions(few).map((v) => v.id), ["a", "b"]);

  // Newest-first list: 5 autos (newest) + 30 named (oldest) = 35.
  // The 5 autos must go even though the named ones are older.
  const autos = Array.from({ length: 5 }, (_, i) =>
    stub({ id: `auto-${i}`, auto: true }),
  );
  const named = Array.from({ length: 30 }, (_, i) =>
    stub({ id: `named-${i}` }),
  );
  const mixed = [...autos, ...named];
  const prunedMixed = V.pruneVersions(mixed);
  assert.equal(prunedMixed.length, 30);
  assert.ok(prunedMixed.every((v) => !v.auto), "all named versions survive");
  assert.deepEqual(
    prunedMixed.map((v) => v.id),
    named.map((v) => v.id),
  );
  assert.equal(mixed.length, 35, "input array is not mutated");

  // No autos at all: the oldest overall drop, the NEWEST 30 are kept.
  const allNamed = Array.from({ length: 35 }, (_, i) => stub({ id: `v${i}` }));
  const prunedNamed = V.pruneVersions(allNamed);
  assert.equal(prunedNamed.length, 30);
  assert.equal(prunedNamed[0].id, "v0", "newest kept");
  assert.equal(prunedNamed[29].id, "v29", "the 5 oldest are gone");

  // Autos interleaved with named: oldest autos drop first, one by one.
  const interleaved = [
    stub({ id: "n-new" }),
    stub({ id: "a-1", auto: true }),
    stub({ id: "n-mid" }),
    stub({ id: "a-2", auto: true }),
    stub({ id: "n-old" }),
    stub({ id: "a-3", auto: true }), // oldest overall AND auto
  ];
  assert.deepEqual(
    V.pruneVersions(interleaved, 4).map((v) => v.id),
    ["n-new", "a-1", "n-mid", "n-old"],
    "a-3 then a-2 (oldest autos) drop before any named version",
  );

  // Junk in, empty out.
  assert.deepEqual(V.pruneVersions(null), []);
  assert.deepEqual(V.pruneVersions(undefined), []);
});

// 4. shouldAutoVersion boundaries ------------------------------------------------
check("shouldAutoVersion: none yet, interval boundary, just under", () => {
  assert.equal(V.AUTO_INTERVAL_MS, 15 * 60 * 1000);
  assert.equal(V.shouldAutoVersion([], T0), true, "no versions → due");
  assert.equal(V.shouldAutoVersion(null, T0), true);

  const at = (createdMs) => [
    stub({ createdAt: new Date(createdMs).toISOString() }),
  ];
  assert.equal(
    V.shouldAutoVersion(at(T0), T0 + V.AUTO_INTERVAL_MS),
    true,
    "exactly at the interval → due",
  );
  assert.equal(
    V.shouldAutoVersion(at(T0), T0 + V.AUTO_INTERVAL_MS - 1),
    false,
    "1 ms under the interval → not due",
  );
  assert.equal(
    V.shouldAutoVersion(at(T0), T0 + V.AUTO_INTERVAL_MS + 60_000),
    true,
    "past the interval → due",
  );
  assert.equal(
    V.shouldAutoVersion(at(T0), T0),
    false,
    "a just-taken version is not due again",
  );
  // Only the NEWEST version matters (list is newest-first).
  const list = [
    stub({ createdAt: new Date(T0).toISOString() }),
    stub({ createdAt: new Date(T0 - 10 * V.AUTO_INTERVAL_MS).toISOString() }),
  ];
  assert.equal(V.shouldAutoVersion(list, T0 + 1000), false);
});

// 5. summarizeVersion --------------------------------------------------------------
check("summarizeVersion counts pages and nodes", () => {
  const v = V.makeVersion(makeDoc(), { now: T0 });
  assert.deepEqual(V.summarizeVersion(v), { pages: 2, nodes: 3 });
  assert.deepEqual(V.summarizeVersion(stub({})), { pages: 0, nodes: 0 });
  assert.deepEqual(V.summarizeVersion(null), { pages: 0, nodes: 0 });
  assert.deepEqual(V.summarizeVersion({}), { pages: 0, nodes: 0 });
});

// 6. versionTitle fallbacks -----------------------------------------------------------
check("versionTitle: name wins, then Autosave, then Unnamed version", () => {
  assert.equal(V.versionTitle(stub({ name: "Beta" })), "Beta");
  assert.equal(
    V.versionTitle(stub({ name: "Before restore", auto: true })),
    "Before restore",
    "a named auto version (the restore safety copy) shows its name",
  );
  assert.equal(V.versionTitle(stub({ auto: true })), "Autosave");
  assert.equal(V.versionTitle(stub({ auto: false })), "Unnamed version");
  assert.equal(
    V.versionTitle(V.makeVersion(makeDoc(), { now: T0 })),
    "Unnamed version",
    "makeVersion with no name + manual → Unnamed version",
  );
  assert.equal(
    V.versionTitle(V.makeVersion(makeDoc(), { auto: true, now: T0 })),
    "Autosave",
  );
});

console.log(`\n${passed} versions checks passed`);
