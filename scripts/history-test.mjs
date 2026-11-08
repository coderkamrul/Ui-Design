/**
 * Standalone checks for lib/history.js (M3) — run with:
 *   node scripts/history-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern as
 * scripts/geom-test.mjs / model-test.mjs: the package has no
 * "type": "module").
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

const H = await load("../lib/history.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const entry = (key, ts, doc = {}) => H.makeEntry(doc, key, ts);

// 1. Coalescing window logic -------------------------------------------------
check("shouldCoalesce window logic", () => {
  const last = entry("nudge:a", 1000);
  // same key, inside the window -> coalesce
  assert.equal(H.shouldCoalesce(last, "nudge:a", 1500, 1000), true);
  assert.equal(H.shouldCoalesce(last, "nudge:a", 2000, 1000), true); // edge
  // same key, window expired -> new entry
  assert.equal(H.shouldCoalesce(last, "nudge:a", 2001, 1000), false);
  // different key -> never
  assert.equal(H.shouldCoalesce(last, "nudge:b", 1200, 1000), false);
  assert.equal(H.shouldCoalesce(last, "patch:x:style", 1200, 1000), false);
  // null key (discrete commits) -> never
  assert.equal(H.shouldCoalesce(last, null, 1200, 1000), false);
  // no last entry -> never
  assert.equal(H.shouldCoalesce(undefined, "nudge:a", 1200, 1000), false);
  assert.equal(H.shouldCoalesce(null, "nudge:a", 1200, 1000), false);
});

// 2. applyCommit: a nudge burst is ONE entry, keeping the pre-burst snapshot -
check("applyCommit coalesces a burst into one entry", () => {
  let history = { past: [], future: [] };
  history = H.applyCommit(history, entry("nudge:a", 0, { v: 0 }));
  history = H.applyCommit(history, entry("nudge:a", 400, { v: 1 }));
  history = H.applyCommit(history, entry("nudge:a", 800, { v: 2 }));
  assert.equal(history.past.length, 1);
  // the surviving snapshot is the FIRST one (state before the burst)
  assert.deepEqual(history.past[0].doc, { v: 0 });
  // the timestamp rolls forward so a continuous burst keeps coalescing
  assert.equal(history.past[0].ts, 800);
  history = H.applyCommit(history, entry("nudge:a", 1900, { v: 3 }));
  assert.equal(history.past.length, 2); // 1100ms gap > window: new entry
  // a different key always starts a new entry
  history = H.applyCommit(history, entry("patch:a:style", 1950, { v: 4 }));
  assert.equal(history.past.length, 3);
});

// 3. Any commit clears the redo stack -----------------------------------------
check("applyCommit clears the redo stack", () => {
  const history = {
    past: [entry(null, 0)],
    future: [entry(null, 10), entry(null, 20)],
  };
  const next = H.applyCommit(history, entry(null, 30));
  assert.deepEqual(next.future, []);
  // ... including a coalesced commit
  const h2 = {
    past: [entry("nudge:a", 100)],
    future: [entry(null, 110)],
  };
  const next2 = H.applyCommit(h2, entry("nudge:a", 200));
  assert.deepEqual(next2.future, []);
  assert.equal(next2.past.length, 1);
});

// 4. Cap behaviour in pushHistory ----------------------------------------------
check("pushHistory cap drops the oldest entries", () => {
  let past = [];
  for (let i = 0; i < 5; i++) past = H.pushHistory(past, entry(null, i, { i }), 3);
  assert.equal(past.length, 3);
  assert.deepEqual(
    past.map((e) => e.doc.i),
    [2, 3, 4],
  );
  // default cap is 100
  let big = [];
  for (let i = 0; i < 105; i++) big = H.pushHistory(big, entry(null, i, { i }));
  assert.equal(big.length, 100);
  assert.equal(big[0].doc.i, 5);
  // inputs are not mutated
  const before = [entry(null, 0, { i: 0 })];
  H.pushHistory(before, entry(null, 1, { i: 1 }), 1);
  assert.equal(before.length, 1);
});

// 5. applyCommit honours the cap too ---------------------------------------------
check("applyCommit honours the cap", () => {
  let history = { past: [], future: [] };
  for (let i = 0; i < 4; i++) {
    history = H.applyCommit(history, entry(null, i * 2000, { i }), 2);
  }
  assert.equal(history.past.length, 2);
  assert.deepEqual(
    history.past.map((e) => e.doc.i),
    [2, 3],
  );
});

console.log(`\n${passed} history checks passed`);
