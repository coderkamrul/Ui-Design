/**
 * Standalone checks for lib/color.js (depth-gap batch: the OKLCH
 * colour editor's conversion layer) — run with:
 *   node scripts/color-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern
 * as the other suites: the package has no "type": "module"). color.js
 * is import-free precisely so this works.
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

const C = await load("../lib/color.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const near = (a, b, tol, label) =>
  assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} ≈ ${b} (±${tol})`);

check("hex <-> rgb parsing and formatting", () => {
  assert.deepEqual(C.hexToRgb("#FF0000"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(C.hexToRgb("#0f8"), { r: 0, g: 255, b: 136 });
  assert.deepEqual(C.hexToRgb("#3B82F6"), { r: 59, g: 130, b: 246 });
  assert.deepEqual(C.hexToRgb("#FF000080"), { r: 255, g: 0, b: 0 }); // alpha byte ignored
  assert.equal(C.hexToRgb("red"), null);
  assert.equal(C.hexToRgb("#GGGGGG"), null);
  assert.equal(C.hexToRgb(42), null);
  assert.equal(C.rgbToHex({ r: 59, g: 130, b: 246 }), "#3B82F6");
  assert.equal(C.rgbToHex({ r: 300, g: -5, b: 0 }), "#FF0000"); // clamped
});

check("#FF0000 → OKLCH matches the reference values", () => {
  const o = C.hexToOklch("#FF0000");
  near(o.l, 0.627955, 1e-3, "L");
  near(o.c, 0.257683, 1e-3, "C");
  near(o.h, 29.2339, 1e-3, "H");
});

check("white and black anchors", () => {
  const w = C.hexToOklch("#FFFFFF");
  near(w.l, 1, 1e-3, "white L");
  near(w.c, 0, 1e-3, "white C");
  assert.equal(C.oklchToHex({ l: 1, c: 0, h: 0 }), "#FFFFFF");
  const b = C.hexToOklch("#000000");
  near(b.l, 0, 1e-6, "black L");
  near(b.c, 0, 1e-6, "black C");
  assert.equal(C.oklchToHex({ l: 0, c: 0, h: 0 }), "#000000");
});

check("hex → oklch → hex roundtrips within ±1 per channel", () => {
  const spread = [
    "#FF0000", "#00FF00", "#0000FF", "#3B82F6", "#12A594", "#E5484D",
    "#F76B15", "#8E4EC6", "#808080", "#123456", "#ABCDEF", "#0A0B0C",
    "#FEFEFE", "#7A3B00", "#005F73",
  ];
  for (const hex of spread) {
    const back = C.oklchToHex(C.hexToOklch(hex));
    const a = C.hexToRgb(hex);
    const b = C.hexToRgb(back);
    for (const ch of ["r", "g", "b"]) {
      assert.ok(
        Math.abs(a[ch] - b[ch]) <= 1,
        `${hex} channel ${ch}: ${a[ch]} vs ${b[ch]} (via ${back})`,
      );
    }
  }
  // the primaries roundtrip exactly
  assert.equal(C.oklchToHex(C.hexToOklch("#FF0000")), "#FF0000");
  assert.equal(C.oklchToHex(C.hexToOklch("#00FF00")), "#00FF00");
  assert.equal(C.oklchToHex(C.hexToOklch("#0000FF")), "#0000FF");
});

check("HSL conversions roundtrip (incl. achromatic)", () => {
  assert.deepEqual(C.rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, l: 0.5 });
  const blue = C.rgbToHsl({ r: 59, g: 130, b: 246 });
  near(blue.h, 217.2, 0.5, "blue H");
  near(blue.s, 0.912, 0.01, "blue S");
  near(blue.l, 0.598, 0.01, "blue L");
  assert.deepEqual(C.hslToRgb(blue), { r: 59, g: 130, b: 246 });
  // grey: s 0, hue pinned to 0, exact roundtrip
  const grey = C.rgbToHsl({ r: 128, g: 128, b: 128 });
  assert.equal(grey.s, 0);
  assert.equal(grey.h, 0);
  assert.deepEqual(C.hslToRgb(grey), { r: 128, g: 128, b: 128 });
  // hue wraps
  assert.deepEqual(C.hslToRgb({ h: 360, s: 1, l: 0.5 }), { r: 255, g: 0, b: 0 });
  assert.deepEqual(C.hslToRgb({ h: -120, s: 1, l: 0.5 }), { r: 0, g: 0, b: 255 });
});

check("out-of-gamut OKLCH clamps to a valid hex (no NaN)", () => {
  const hex = C.oklchToHex({ l: 0.7, c: 0.35, h: 250 });
  assert.match(hex, /^#[0-9A-F]{6}$/);
  const rgb = C.hexToRgb(hex);
  for (const ch of ["r", "g", "b"]) {
    assert.ok(Number.isFinite(rgb[ch]) && rgb[ch] >= 0 && rgb[ch] <= 255);
  }
  // an extreme case stays finite too
  assert.match(C.oklchToHex({ l: 0.5, c: 0.4, h: 0 }), /^#[0-9A-F]{6}$/);
  assert.match(C.oklchToHex({ l: 2, c: 0.4, h: 120 }), /^#[0-9A-F]{6}$/);
});

check("oklch string formatting + parsing + colour-string entry point", () => {
  assert.equal(
    C.formatOklch({ l: 0.627955, c: 0.257683, h: 29.2339 }),
    "oklch(0.628 0.2577 29.23)",
  );
  assert.deepEqual(C.parseOklch("oklch(0.62 0.19 256)"), { l: 0.62, c: 0.19, h: 256 });
  const pct = C.parseOklch("oklch(62% 0.19 256)");
  near(pct.l, 0.62, 1e-9, "percent L");
  assert.equal(C.parseOklch("oklch(nonsense)"), null);
  assert.equal(C.parseOklch("#FF0000"), null);
  // colorToRgb accepts hex, oklch() strings (token literals) and rgb()
  assert.deepEqual(C.colorToRgb("#3B82F6"), { r: 59, g: 130, b: 246 });
  const fromOklch = C.colorToRgb("oklch(0.627955 0.257683 29.2339)");
  assert.ok(Math.abs(fromOklch.r - 255) <= 1 && fromOklch.g <= 1 && fromOklch.b <= 1);
  assert.deepEqual(C.colorToRgb("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3 });
  assert.equal(C.colorToRgb("rebeccapurple"), null);
  assert.equal(C.colorToRgb(null), null);
});

check("oklchToHex carries alpha only when asked", () => {
  assert.equal(C.oklchToHex({ l: 0.627955, c: 0.257683, h: 29.2339 }), "#FF0000");
  assert.equal(C.oklchToHex({ l: 0.627955, c: 0.257683, h: 29.2339 }, 1), "#FF0000");
  assert.equal(
    C.oklchToHex({ l: 0.627955, c: 0.257683, h: 29.2339 }, 0.5),
    "#FF000080",
  );
});

console.log(`\n${passed} color checks passed`);
