/**
 * Standalone checks for lib/snap.js (M4) — run with:
 *   node scripts/snap-test.mjs
 *
 * lib/snap.js is import-free ESM inside a package without
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

const S = await load("../lib/snap.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const fixed = (px) => ({ kind: "fixed", px });
function node(id, x, y, w, h, parentId = null) {
  return {
    id,
    type: "rect",
    parentId,
    childIds: [],
    position: { x, y },
    size: { w: fixed(w), h: fixed(h) },
  };
}

// A at (100,100) 80×40 → v lines 100 / 140 / 180; B far away at (400,300).
const nodes = {
  a: node("a", 100, 100, 80, 40),
  b: node("b", 400, 300, 50, 50),
};

// 1. Edge snap within the threshold -------------------------------------------
check("edge snap within threshold", () => {
  const lines = S.collectSnapLines(nodes, new Set(["b"]));
  const snap = S.computeSnap({ x: 96, y: 300, w: 50, h: 40 }, lines, 5);
  assert.equal(snap.dx, 4); // left edge 96 → A's left edge 100
  assert.equal(snap.activeV.at, 100);
  assert.equal(snap.activeV.kind, "edge");
});

// 2. Centre snap ----------------------------------------------------------------
check("centre snap", () => {
  const lines = S.collectSnapLines(nodes, new Set(["b"]));
  // moving centre x = 119 + 25 = 144 → A's centre 140, delta −4; no edge
  // candidate is within the threshold (left 119→100 is 19, right 169→180
  // is 11), so the centre line must win.
  const snap = S.computeSnap({ x: 119, y: 300, w: 50, h: 40 }, lines, 5);
  assert.equal(snap.dx, -4);
  assert.equal(snap.activeV.at, 140);
  assert.equal(snap.activeV.kind, "center");
});

// 3. No snap beyond the threshold ----------------------------------------------
check("no snap beyond threshold", () => {
  const lines = S.collectSnapLines(nodes, new Set(["b"]));
  // parked far from every line on both axes (nearest line is >60px away)
  const snap = S.computeSnap({ x: 250, y: 500, w: 50, h: 40 }, lines, 5);
  assert.equal(snap.dx, 0);
  assert.equal(snap.dy, 0);
  assert.equal(snap.activeV, null);
  assert.equal(snap.activeH, null);
});

// 4. Guide lines are collected (v/h lines + grid inner boundaries) --------------
check("guide lines included", () => {
  const frameGuides = [
    {
      rect: { x: 0, y: 0, w: 400, h: 300 },
      guides: [
        { kind: "v", pos: 200 },
        { kind: "grid", count: 4 },
      ],
    },
  ];
  const lines = S.collectSnapLines(nodes, new Set(["b"]), frameGuides);
  const vAts = lines.v.map((l) => l.at);
  assert.ok(vAts.includes(200)); // the v guide AND the grid's middle line
  assert.ok(vAts.includes(100)); // grid inner boundary 400 × 1/4
  assert.ok(vAts.includes(300)); // grid inner boundary 400 × 3/4
  const snap = S.computeSnap({ x: 197, y: 500, w: 40, h: 40 }, lines, 5);
  assert.equal(snap.dx, 3);
  assert.equal(snap.activeV.at, 200);
  assert.equal(snap.activeV.kind, "guide");
});

// 5. The moving subtree contributes no lines --------------------------------------
check("moving nodes are excluded", () => {
  const lines = S.collectSnapLines(nodes, new Set(["a"]));
  const vAts = lines.v.map((l) => l.at);
  assert.ok(!vAts.includes(100)); // A's own left edge is gone
  assert.ok(vAts.includes(400)); // B's left edge remains
});

// 6. Resize snap to parent edge with stickiness -----------------------------------
check("resize snap to parent edge and stickiness", () => {
  const parentId = "frame-p";
  const testNodes = {
    "frame-p": {
      id: "frame-p",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: { kind: "fixed", px: 500 }, h: { kind: "fixed", px: 400 } },
    },
    "child-c": {
      id: "child-c",
      parentId: "frame-p",
      type: "rectangle",
      position: { x: 50, y: 50 },
      size: { w: { kind: "fixed", px: 200 }, h: { kind: "fixed", px: 100 } },
    },
  };
  const lines = S.collectSnapLines(testNodes, new Set(["child-c"]), [], parentId);
  
  // Resizing right handle "e": start w=200 at x=50, rawDx=246 -> right=496, parent right=500 (distance 4 <= 8)
  const snap1 = S.computeResizeSnap({ x: 50, y: 50, w: 200, h: 100 }, "e", 246, 0, lines, 8);
  assert.equal(snap1.dx, 250); // snaps to 500 (50 + 200 + 250 = 500)
  assert.equal(snap1.activeV.at, 500);
  assert.equal(snap1.activeV.kind, "parent-edge");

  // If user moves beyond threshold: rawDx=270 -> right=520 (distance 20 > 8) -> releases
  const snap2 = S.computeResizeSnap({ x: 50, y: 50, w: 200, h: 100 }, "e", 270, 0, lines, 8);
  assert.equal(snap2.dx, 270);
  assert.equal(snap2.activeV, null);
});

// 7. Gap alignment snap (Figma/Paper style) -----------------------------------
check("gap alignment snap to adjacent frame with 80px gap", () => {
  const threeNodes = {
    a: node("a", 100, 100, 80, 40),
    c: node("c", 260, 100, 80, 40), // gap between a and c is 260 - (100 + 80) = 80px
    b: node("b", 500, 300, 50, 50),
  };
  const lines = S.collectSnapLines(threeNodes, new Set(["b"]));
  // c is at x=260, w=80 -> right edge is 340. With detected 80px gap, candidate is 420.
  // Test moving node B with left edge at 418 (2px away <= 5)
  const snap = S.computeSnap({ x: 418, y: 300, w: 50, h: 40 }, lines, 5);
  assert.equal(snap.dx, 2); // left edge 418 → gap snap line 420
  assert.equal(snap.activeV.at, 420);
  assert.equal(snap.activeV.kind, "gap");
  assert.equal(snap.activeV.gap, 80);
});

console.log(`\n${passed} snap checks passed`);
