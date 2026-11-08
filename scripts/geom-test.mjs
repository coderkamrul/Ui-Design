/**
 * Standalone checks for lib/geometry.js — run with:
 *   node scripts/geom-test.mjs
 *
 * lib/geometry.js is ESM inside a package without "type": "module" (Next
 * handles it; bare node may not), so on a direct-import failure we load the
 * same source through a data: URL. The module has no imports, so both paths
 * exercise identical code.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let G;
try {
  G = await import("../lib/geometry.js");
} catch {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/geometry.js", import.meta.url)),
    "utf8",
  );
  G = await import(`data:text/javascript,${encodeURIComponent(src)}`);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 1. screen <-> canvas round-trip at several zooms
check("screen<->canvas round-trip", () => {
  for (const zoom of [0.02, 0.15, 0.5, 1, 2, 13.7, 256]) {
    const vp = { x: 123.4, y: -56.7, zoom };
    const p = { x: 640.2, y: 389.9 };
    const back = G.canvasToScreen(vp, G.screenToCanvas(vp, p));
    assert.ok(near(back.x, p.x, 1e-6), `x at zoom ${zoom}`);
    assert.ok(near(back.y, p.y, 1e-6), `y at zoom ${zoom}`);
  }
});

// 2. zoom-to-cursor invariant: the canvas point under the cursor is fixed
check("zoom-to-cursor invariant", () => {
  const cases = [
    { vp: { x: 0, y: 0, zoom: 1 }, pt: { x: 400, y: 300 }, z: 2 },
    { vp: { x: -120, y: 80, zoom: 0.5 }, pt: { x: 10, y: 590 }, z: 3.3 },
    { vp: { x: 44, y: -900, zoom: 8 }, pt: { x: 799, y: 1 }, z: 0.25 },
    { vp: { x: 12, y: 12, zoom: 1 }, pt: { x: 0, y: 0 }, z: 999 }, // clamps
  ];
  for (const { vp, pt, z } of cases) {
    const before = G.screenToCanvas(vp, pt);
    const next = G.zoomToCursor(vp, pt, z);
    assert.equal(next.zoom, G.clampZoom(z));
    const after = G.screenToCanvas(next, pt);
    assert.ok(near(after.x, before.x, 1e-6), "canvas x under cursor moved");
    assert.ok(near(after.y, before.y, 1e-6), "canvas y under cursor moved");
  }
});

// 3. zoom clamping to the spec range 2% .. 25,600%
check("zoom clamp range", () => {
  assert.equal(G.clampZoom(0.001), 0.02);
  assert.equal(G.clampZoom(10000), 256);
  assert.equal(G.clampZoom(1.5), 1.5);
});

// 4. marquee intersection rule
check("rectsIntersect (crossing counts, touching does not)", () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(G.rectsIntersect(box, { x: 50, y: 50, w: 100, h: 100 }), true);
  assert.equal(G.rectsIntersect(box, { x: 10, y: 10, w: 5, h: 5 }), true);
  assert.equal(G.rectsIntersect(box, { x: -40, y: 20, w: 50, h: 10 }), true);
  assert.equal(G.rectsIntersect(box, { x: 100, y: 0, w: 50, h: 50 }), false);
  assert.equal(G.rectsIntersect(box, { x: 200, y: 200, w: 10, h: 10 }), false);
});

// 5. rect union + normalize
check("rectUnion / normalizeRect", () => {
  const u = G.rectUnion([
    { x: 10, y: 20, w: 30, h: 40 },
    { x: -5, y: 100, w: 10, h: 10 },
  ]);
  assert.deepEqual(u, { x: -5, y: 20, w: 45, h: 90 });
  assert.deepEqual(G.normalizeRect(50, 80, 10, 20), { x: 10, y: 20, w: 40, h: 60 });
});

// 6. fit viewport: bounds land centred and inside the container
check("fitViewport centres bounds", () => {
  const bounds = { x: 100, y: 50, w: 940, h: 392 };
  const size = { w: 1200, h: 800 };
  const vp = G.fitViewport(bounds, size, 48);
  const tl = G.canvasToScreen(vp, bounds);
  const br = G.canvasToScreen(vp, { x: bounds.x + bounds.w, y: bounds.y + bounds.h });
  assert.ok(tl.x >= 47 && br.x <= size.w - 47, "horizontal fit");
  assert.ok(near((tl.x + br.x) / 2, size.w / 2, 1e-6), "horizontally centred");
  assert.ok(near((tl.y + br.y) / 2, size.h / 2, 1e-6), "vertically centred");
});

// 7. resize: opposite edge fixed, min size, aspect lock
check("resizeRect", () => {
  const start = { x: 100, y: 100, w: 200, h: 100 };
  // SE corner: origin fixed, both axes grow
  assert.deepEqual(G.resizeRect(start, "se", 50, 30, false), { x: 100, y: 100, w: 250, h: 130 });
  // W edge: east edge (x=300) fixed
  const west = G.resizeRect(start, "w", 40, 0, false);
  assert.deepEqual(west, { x: 140, y: 100, w: 160, h: 100 });
  assert.equal(west.x + west.w, 300);
  // N edge dragged past the bottom clamps to 1px, south edge fixed
  const north = G.resizeRect(start, "n", 0, 500, false);
  assert.equal(north.h, 1);
  assert.equal(north.y + north.h, 200);
  // Aspect: corner drag keeps the 2:1 ratio
  const asp = G.resizeRect(start, "se", 100, 0, true);
  assert.ok(near(asp.w / asp.h, 2, 1e-9), "ratio preserved");
});

// 8. tree math over a small fixture: absolute rects, roots, parent search
check("node tree helpers", () => {
  const nodes = {
    f: { id: "f", type: "frame", parentId: null, childIds: ["r"], position: { x: 10, y: 20 }, size: { w: { kind: "fixed", px: 300 }, h: { kind: "fixed", px: 200 } } },
    r: { id: "r", type: "rect", parentId: "f", childIds: [], position: { x: 5, y: 6 }, size: { w: { kind: "fixed", px: 50 }, h: { kind: "fixed", px: 40 } } },
    t: { id: "t", type: "rect", parentId: null, childIds: [], position: { x: 500, y: 0 }, size: { w: { kind: "fixed", px: 10 }, h: { kind: "fixed", px: 10 } } },
  };
  const page = { rootNodeIds: ["f", "t"] };
  assert.deepEqual(G.absoluteRect(nodes, "r"), { x: 15, y: 26, w: 50, h: 40 });
  assert.deepEqual(G.absoluteRect(nodes, "non-existent"), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(G.nodeSizePx(undefined), { w: 0, h: 0 });
  assert.deepEqual(G.selectionRoots(nodes, ["f", "r"]), ["f"]);
  assert.deepEqual(G.selectionRoots(nodes, ["non-existent"]), []);
  assert.deepEqual(G.subtreeIds(nodes, "f"), ["f", "r"]);
  assert.equal(G.findFrameAtPoint(nodes, page, { x: 30, y: 40 }), "f");
  assert.equal(G.findFrameAtPoint(nodes, page, { x: 900, y: 900 }), null);
  assert.equal(G.pageBounds(nodes, { rootNodeIds: ["non-existent"] }), null);

  // Hidden nodes check
  assert.equal(G.isNodeHidden(nodes, "f"), false);
  assert.equal(G.isNodeHidden(nodes, "r"), false);
  nodes.f.hidden = true;
  assert.equal(G.isNodeHidden(nodes, "f"), true);
  assert.equal(G.isNodeHidden(nodes, "r"), true); // child of hidden parent is also hidden
  assert.equal(G.findFrameAtPoint(nodes, page, { x: 30, y: 40 }), null); // hidden frame not hit
  assert.deepEqual(G.pageBounds(nodes, page), { x: 500, y: 0, w: 10, h: 10 }); // only visible "t" included
});

console.log(`\n${passed} geometry checks passed`);
