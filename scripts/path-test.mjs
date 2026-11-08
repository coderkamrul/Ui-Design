/**
 * Standalone checks for lib/path.js (M4) — run with:
 *   node scripts/path-test.mjs
 *
 * lib/path.js is import-free ESM inside a package without
 * "type": "module", so (like the other suites) it is loaded through a
 * data: URL when a direct import fails.
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

const P = await load("../lib/path.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const corner = (x, y) => ({ x, y, in: null, out: null, smooth: false });

// 1. Corner anchors produce straight L segments -----------------------------
check("anchorsToD: straight lines for corner anchors", () => {
  assert.equal(
    P.anchorsToD([corner(0, 0), corner(100, 0), corner(100, 50)], false),
    "M 0 0 L 100 0 L 100 50",
  );
  // degenerate inputs
  assert.equal(P.anchorsToD([], false), "");
  assert.equal(P.anchorsToD([corner(5, 5)], false), "M 5 5");
});

// 2. Handles produce cubic C segments ----------------------------------------
check("anchorsToD: C segments from out/in handles", () => {
  const a = { x: 0, y: 0, in: null, out: { x: 30, y: 0 }, smooth: true };
  const b = { x: 100, y: 0, in: { x: 70, y: 0 }, out: null, smooth: true };
  assert.equal(P.anchorsToD([a, b], false), "M 0 0 C 30 0, 70 0, 100 0");
  // one-sided handle: the missing control point falls back to the anchor
  const c = { x: 0, y: 0, in: null, out: null, smooth: false };
  const d = { x: 100, y: 0, in: { x: 70, y: 0 }, out: null, smooth: false };
  assert.equal(P.anchorsToD([c, d], false), "M 0 0 C 0 0, 70 0, 100 0");
});

// 3. Closed paths add the closing segment + Z ---------------------------------
check("anchorsToD: closed adds closing segment and Z", () => {
  assert.equal(
    P.anchorsToD([corner(0, 0), corner(100, 0)], true),
    "M 0 0 L 100 0 L 0 0 Z",
  );
  // a single anchor is never closed
  assert.equal(P.anchorsToD([corner(5, 5)], true), "M 5 5");
});

// 4. Bounds -------------------------------------------------------------------
check("pathBounds: min/max over anchor points", () => {
  assert.deepEqual(P.pathBounds([corner(10, 20), corner(-5, 40), corner(30, -10)]), {
    x: -5,
    y: -10,
    w: 35,
    h: 50,
  });
  assert.deepEqual(P.pathBounds([]), { x: 0, y: 0, w: 0, h: 0 });
});

// 5. Smooth toggle: mirroring math --------------------------------------------
check("toggleAnchorSmooth: mirrors the existing handle", () => {
  const anchor = { x: 100, y: 100, in: null, out: { x: 130, y: 100 }, smooth: false };
  const on = P.toggleAnchorSmooth(anchor, corner(0, 100), corner(200, 100));
  assert.equal(on.smooth, true);
  assert.deepEqual(on.out, { x: 130, y: 100 });
  assert.deepEqual(on.in, { x: 70, y: 100 }); // mirrored through the anchor
  // toggling back to corner keeps the handle positions, unlinks mirroring
  const off = P.toggleAnchorSmooth(on, corner(0, 100), corner(200, 100));
  assert.equal(off.smooth, false);
  assert.deepEqual(off.in, { x: 70, y: 100 });
  assert.deepEqual(off.out, { x: 130, y: 100 });
});

check("toggleAnchorSmooth: creates handles at 1/3 neighbour distance", () => {
  const on = P.toggleAnchorSmooth(corner(100, 100), corner(0, 100), corner(200, 100));
  assert.equal(on.smooth, true);
  assert.deepEqual(on.out, { x: 100 + 100 / 3, y: 100 });
  assert.deepEqual(on.in, { x: 100 - 100 / 3, y: 100 });
  // one neighbour only (path end): the handle toward the neighbour is
  // created at 1/3 distance and mirrored to the other side
  const end = P.toggleAnchorSmooth(corner(100, 100), corner(0, 100), null);
  assert.deepEqual(end.in, { x: 100 - 100 / 3, y: 100 });
  assert.deepEqual(end.out, { x: 100 + 100 / 3, y: 100 });
});

// 6. Handle dragging mirrors only when smooth ----------------------------------
check("mirrorHandle: smooth mirrors angle+length, corner does not", () => {
  const smooth = { x: 0, y: 0, in: { x: -30, y: 0 }, out: { x: 30, y: 0 }, smooth: true };
  const moved = P.mirrorHandle(smooth, "out", { x: 40, y: 10 });
  assert.deepEqual(moved.out, { x: 40, y: 10 });
  assert.deepEqual(moved.in, { x: -40, y: -10 });
  const cornerAnchor = { ...smooth, smooth: false };
  const movedCorner = P.mirrorHandle(cornerAnchor, "out", { x: 40, y: 10 });
  assert.deepEqual(movedCorner.in, { x: -30, y: 0 });
});

// 7. Normalisation: bbox becomes the node box -----------------------------------
check("normalizeAnchors: min shifts to 0,0 and reports offset+size", () => {
  const { anchors, offset, size } = P.normalizeAnchors([
    { x: 10, y: 20, in: null, out: { x: 15, y: 25 }, smooth: false },
    corner(30, 5),
  ]);
  assert.deepEqual(offset, { x: 10, y: 5 });
  assert.deepEqual(size, { w: 20, h: 15 });
  assert.deepEqual(anchors[0], {
    x: 0,
    y: 15,
    in: null,
    out: { x: 5, y: 20 },
    smooth: false,
  });
  assert.deepEqual(anchors[1], corner(20, 0));
});

console.log(`\n${passed} path checks passed`);
