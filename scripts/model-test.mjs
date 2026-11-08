/**
 * Standalone checks for lib/model.js + lib/flex.js (M2) — run with:
 *   node scripts/model-test.mjs
 *
 * Both modules are import-free ESM inside a package without
 * "type": "module", so (like scripts/geom-test.mjs) each is loaded through
 * a data: URL when a direct import fails.
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

const M = await load("../lib/model.js");
const F = await load("../lib/flex.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// 1. Token alias chains resolve to the final literal ------------------------
check("token alias chain resolution", () => {
  const tokens = [
    { id: "t-base", type: "color", name: "Base", value: "#112233" },
    { id: "t-mid", type: "color", name: "Mid", aliasOf: "t-base" },
    { id: "t-top", type: "color", name: "Top", aliasOf: "t-mid" },
  ];
  assert.equal(M.resolveToken(tokens, "t-top"), "#112233");
  assert.equal(M.resolveToken(tokens, "t-mid"), "#112233");
  assert.equal(F.resolveTokenValue(tokens, "t-top"), "#112233");
  // a cycle must terminate, not hang
  const cyclic = [
    { id: "a", type: "color", name: "A", aliasOf: "b" },
    { id: "b", type: "color", name: "B", aliasOf: "a" },
  ];
  assert.equal(M.resolveToken(cyclic, "a"), undefined);
});

// 2. Delete-in-use: bindings auto-detach to literals -------------------------
check("delete-token auto-detach", () => {
  const doc = {
    tokens: [
      { id: "t-base", type: "color", name: "Base", value: "#FF0000" },
      { id: "t-alias", type: "color", name: "Alias", aliasOf: "t-base" },
      { id: "t-gap", type: "spacing", name: "Gap", value: 24 },
      { id: "t-rad", type: "radius", name: "Rad", value: 8 },
    ],
    nodes: {
      n1: {
        id: "n1",
        style: { fill: { kind: "token", tokenId: "t-alias" } },
        size: { w: { kind: "fixed", px: 10 }, h: { kind: "fixed", px: 10 } },
        layout: { mode: "freeform" },
      },
      n2: {
        id: "n2",
        style: { radius: { tokenId: "t-rad" } },
        size: {
          w: { kind: "token", tokenId: "t-gap" },
          h: { kind: "fixed", px: 10 },
        },
        layout: {
          mode: "flex",
          gap: { tokenId: "t-gap" },
          padding: { h: { tokenId: "t-gap" }, v: 4 },
        },
      },
    },
  };

  M.detachToken(doc, "t-gap");
  assert.equal(doc.nodes.n2.layout.gap, 24);
  assert.equal(doc.nodes.n2.layout.padding.h, 24);
  assert.equal(doc.nodes.n2.layout.padding.v, 4);
  assert.deepEqual(doc.nodes.n2.size.w, { kind: "fixed", px: 24 });
  assert.equal(doc.tokens.some((t) => t.id === "t-gap"), false);

  M.detachToken(doc, "t-rad");
  assert.equal(doc.nodes.n2.style.radius, 8);

  // deleting the base of an alias chain turns the alias into a literal
  M.detachToken(doc, "t-base");
  const alias = doc.tokens.find((t) => t.id === "t-alias");
  assert.equal(alias.aliasOf, undefined);
  assert.equal(alias.value, "#FF0000");
  // n1 is still bound to the (now literal) alias — binding survives
  assert.deepEqual(doc.nodes.n1.style.fill, { kind: "token", tokenId: "t-alias" });

  // deleting the alias itself detaches the fill to the resolved literal
  M.detachToken(doc, "t-alias");
  assert.deepEqual(doc.nodes.n1.style.fill, {
    kind: "solid",
    color: "#FF0000",
    alpha: 1,
  });
});

// 3. Flex main-axis distribution (spec: first Fill takes the remainder) -----
check("flex Fill distribution", () => {
  const fixed = (px) => ({ kind: "fixed", px });
  // 560 container, 16px padding each side, gap 24: 120 + Fill + 96
  assert.deepEqual(
    F.flexMainSizes({
      containerMain: 560,
      paddingMain: 32,
      gap: 24,
      items: [
        { sizing: fixed(120) },
        { sizing: { kind: "fill" } },
        { sizing: fixed(96) },
      ],
    }),
    [120, 264, 96],
  );
  // two Fills: the second collapses to 0 (the spec rule)
  assert.deepEqual(
    F.flexMainSizes({
      containerMain: 400,
      paddingMain: 0,
      gap: 0,
      items: [
        { sizing: fixed(100) },
        { sizing: { kind: "fill" } },
        { sizing: { kind: "fill" } },
      ],
    }),
    [100, 300, 0],
  );
  // relative = % of content box; fit consumes its measured size
  assert.deepEqual(
    F.flexMainSizes({
      containerMain: 400,
      paddingMain: 0,
      gap: 10,
      items: [
        { sizing: { kind: "relative", pct: 50 } },
        { sizing: { kind: "fit" }, fitPx: 80 },
        { sizing: { kind: "fill" } },
      ],
    }),
    [200, 80, 100],
  );
  // firstFillIndex over in-flow children only
  const kids = [
    { size: { w: fixed(10) }, position: {} },
    { size: { w: { kind: "fill" } }, position: { absolute: true } },
    { size: { w: { kind: "fill" } }, position: {} },
  ];
  assert.equal(F.firstFillIndex(kids, "w"), 1); // index into in-flow list
});

// 3b. Drag-reorder slot computation (depth-gap batch) --------------------------
check("insertionIndex counts midpoints before the pointer", () => {
  const rows = [
    { x: 0, y: 0, w: 100, h: 20 },
    { x: 0, y: 28, w: 100, h: 20 },
    { x: 0, y: 56, w: 100, h: 20 },
  ]; // midpoints y = 10, 38, 66
  assert.equal(F.insertionIndex(rows, "y", -5), 0);
  assert.equal(F.insertionIndex(rows, "y", 9), 0);
  assert.equal(F.insertionIndex(rows, "y", 10), 0); // exactly ON a midpoint: not before
  assert.equal(F.insertionIndex(rows, "y", 11), 1);
  assert.equal(F.insertionIndex(rows, "y", 40), 2);
  assert.equal(F.insertionIndex(rows, "y", 500), 3); // past the end
  assert.equal(F.insertionIndex([], "y", 50), 0);
  // x axis (row direction)
  const cols = [
    { x: 0, y: 0, w: 30, h: 10 },
    { x: 40, y: 0, w: 30, h: 10 },
  ]; // midpoints x = 15, 55
  assert.equal(F.insertionIndex(cols, "x", 20), 1);
  assert.equal(F.insertionIndex(cols, "x", 60), 2);
});

check("reorderList moves an id and no-ops in place", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(F.reorderList(ids, "b", 0), ["b", "a", "c", "d"]);
  assert.deepEqual(F.reorderList(ids, "b", 2), ["a", "c", "b", "d"]);
  assert.deepEqual(F.reorderList(ids, "b", 3), ["a", "c", "d", "b"]);
  assert.deepEqual(F.reorderList(ids, "a", 3), ["b", "c", "d", "a"]);
  // dropping b back between a and c is where it already is → null
  assert.equal(F.reorderList(ids, "b", 1), null);
  assert.equal(F.reorderList(ids, "a", 0), null);
  assert.equal(F.reorderList(ids, "d", 3), null);
  // out-of-range indices clamp; unknown ids are inert
  assert.deepEqual(F.reorderList(ids, "a", 99), ["b", "c", "d", "a"]);
  assert.equal(F.reorderList(ids, "zzz", 1), null);
  // the canvas/Layers composition: insertionIndex over the OTHERS,
  // then reorderList, lands the dragged node in the pointed-at slot
  const rects = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 0, y: 20, w: 10, h: 10 },
    { x: 0, y: 40, w: 10, h: 10 },
  ]; // siblings a, c, d (b is being dragged); midpoints 5, 25, 45
  const at = F.insertionIndex(rects, "y", 30);
  assert.equal(at, 2);
  assert.deepEqual(F.reorderList(ids, "b", at), ["a", "c", "b", "d"]);
});

// 4. Gradient CSS builder ------------------------------------------------------
check("gradient CSS builder", () => {
  assert.equal(
    M.buildGradientCss({
      kind: "gradient",
      gradientType: "linear",
      angle: 90,
      stops: [
        { color: "#000000", alpha: 1, at: 0 },
        { color: "#FFFFFF", alpha: 0.5, at: 100 },
      ],
    }),
    "linear-gradient(90deg, #000000 0%, rgba(255, 255, 255, 0.5) 100%)",
  );
  assert.equal(
    M.buildGradientCss({
      kind: "gradient",
      gradientType: "conic",
      angle: 45,
      stops: [
        { color: "#FF0000", at: 0 },
        { color: "#0000FF", at: 100 },
      ],
    }),
    "conic-gradient(from 45deg, #FF0000 0%, #0000FF 100%)",
  );
  assert.equal(
    M.buildGradientCss({
      kind: "gradient",
      gradientType: "radial",
      stops: [
        { color: "#FFFFFF", at: 0 },
        { color: "#000000", at: 100 },
      ],
    }),
    "radial-gradient(circle, #FFFFFF 0%, #000000 100%)",
  );
});

// 5. Filter CSS builder — only non-default values ------------------------------
check("filter CSS builder (non-defaults only)", () => {
  assert.equal(M.buildFilterCss(M.defaultFilters()), undefined);
  assert.equal(M.buildFilterCss(undefined), undefined);
  assert.equal(M.buildFilterCss({ blur: 4 }), "blur(4px)");
  const merged = { ...M.defaultFilters(), blur: 4, grayscale: 100, saturate: 100 };
  assert.equal(M.buildFilterCss(merged), "blur(4px) grayscale(100%)");
  const hue = { ...M.defaultFilters(), hueRotate: 90, brightness: 120 };
  assert.equal(M.buildFilterCss(hue), "brightness(120%) hue-rotate(90deg)");
});

// 6. Shadow CSS builder ----------------------------------------------------------
check("shadow CSS builder", () => {
  assert.equal(
    M.buildShadowCss([M.defaultShadow()], undefined),
    "0px 2px 3px 0px rgba(0, 0, 0, 0.2)",
  );
  assert.equal(
    M.buildShadowCss([], [{ ...M.defaultShadow(), y: 20, blur: 10 }]),
    "inset 0px 20px 10px 0px rgba(0, 0, 0, 0.2)",
  );
  assert.equal(M.buildShadowCss([], []), undefined);
});

// 7. Frame organization (Figma/Paper style) ------------------------------------
check("frame organization aligns top and applies uniform 80px horizontal gap", () => {
  const frames = [
    { id: "f3", position: { x: 900, y: 150 }, size: { w: { px: 320 } } },
    { id: "f1", position: { x: 100, y: 80 }, size: { w: { px: 600 } } },
    { id: "f2", position: { x: 500, y: 120 }, size: { w: { px: 400 } } },
  ];
  // Sort left to right
  const sorted = [...frames].sort((a, b) => a.position.x - b.position.x);
  assert.equal(sorted[0].id, "f1");
  assert.equal(sorted[1].id, "f2");
  assert.equal(sorted[2].id, "f3");

  const topY = Math.min(...sorted.map((f) => f.position.y));
  assert.equal(topY, 80);

  const gap = 80;
  let curX = sorted[0].position.x;
  const result = [];
  for (const f of sorted) {
    result.push({ id: f.id, x: curX, y: topY });
    curX += f.size.w.px + gap;
  }

  assert.deepEqual(result, [
    { id: "f1", x: 100, y: 80 },
    { id: "f2", x: 780, y: 80 }, // 100 + 600 + 80 = 780
    { id: "f3", x: 1260, y: 80 }, // 780 + 400 + 80 = 1260
  ]);
});

console.log(`\n${passed} model checks passed`);
