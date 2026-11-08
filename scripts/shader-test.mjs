/**
 * Standalone checks for lib/shader.js (M5 shader layers) — run with:
 *   node scripts/shader-test.mjs
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

const S = await load("../lib/shader.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

check("buildUniforms converts hex colours to RGB triples in 0..1", () => {
  const u = S.buildUniforms({
    colors: ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF"],
    params: {},
  });
  assert.equal(u.colors.length, 4);
  assert.deepEqual(u.colors[0], [1, 0, 0]);
  assert.deepEqual(u.colors[1], [0, 1, 0]);
  assert.deepEqual(u.colors[2], [0, 0, 1]);
  assert.deepEqual(u.colors[3], [1, 1, 1]);
  for (const rgb of u.colors) {
    assert.equal(rgb.length, 3);
    for (const v of rgb) assert.ok(v >= 0 && v <= 1, `channel ${v} in 0..1`);
  }
  // Short hex + a mid grey.
  const u2 = S.buildUniforms({ colors: ["#F00", "#808080"], params: {} });
  assert.deepEqual(u2.colors[0], [1, 0, 0]);
  assert.ok(near(u2.colors[1][0], 128 / 255));
});

check("buildUniforms normalises the 0..100 params to 0..1 and degrees to radians", () => {
  const u = S.buildUniforms({
    colors: [],
    params: { scale: 2, rotation: 180, distortion: 35, softness: 60, grain: 12 },
  });
  assert.equal(u.scale, 2);
  assert.ok(near(u.rotationRad, Math.PI, 1e-9));
  assert.ok(near(u.distortion, 0.35));
  assert.ok(near(u.softness, 0.6));
  assert.ok(near(u.grain, 0.12));
});

check("buildUniforms clamps out-of-range params to the PARAM_DEFS ranges", () => {
  const u = S.buildUniforms({
    colors: [],
    params: { scale: 99, rotation: 720, distortion: -5, softness: 250, grain: -1 },
  });
  assert.equal(u.scale, 3);
  assert.ok(near(u.rotationRad, 2 * Math.PI, 1e-9)); // 360° after clamping
  assert.equal(u.distortion, 0);
  assert.equal(u.softness, 1);
  assert.equal(u.grain, 0);
  const low = S.buildUniforms({ colors: [], params: { scale: 0 } });
  assert.equal(low.scale, 0.5);
});

check("buildUniforms tolerates a missing/partial shader (defaults everywhere)", () => {
  for (const input of [undefined, null, {}, { colors: "nope", params: null }]) {
    const u = S.buildUniforms(input);
    assert.equal(u.colors.length, 4);
    assert.equal(u.scale, 1);
    assert.equal(u.rotationRad, 0);
    assert.ok(near(u.distortion, 0.35));
    assert.ok(near(u.softness, 0.6));
    assert.ok(near(u.grain, 0.12));
  }
});

check("every preset has 4 valid hex colours and in-range params", () => {
  assert.ok(S.PRESETS.length >= 4);
  const names = new Set();
  for (const p of S.PRESETS) {
    assert.ok(!names.has(p.name), `preset name ${p.name} unique`);
    names.add(p.name);
    assert.equal(p.colors.length, 4);
    for (const c of p.colors) assert.match(c, /^#[0-9a-f]{6}$/i);
    const norm = S.normalizeParams(p.params);
    assert.deepEqual(norm, p.params, `${p.name} params are already in range`);
  }
});

check("applyPreset returns independent copies (mutation never reaches PRESETS)", () => {
  const a = S.applyPreset(S.PRESETS[0].name);
  const b = S.applyPreset(S.PRESETS[0].name);
  assert.notEqual(a, b);
  assert.notEqual(a.colors, b.colors);
  assert.notEqual(a.params, b.params);
  a.colors[0] = "#000000";
  a.params.scale = 42;
  assert.notEqual(S.PRESETS[0].colors[0], "#000000");
  assert.notEqual(S.PRESETS[0].params.scale, 42);
  assert.equal(b.colors[0], S.PRESETS[0].colors[0]);
  // Unknown preset names fall back to the first preset, still a copy.
  const fb = S.applyPreset("does-not-exist");
  assert.equal(fb.preset, S.PRESETS[0].name);
  assert.deepEqual(fb.colors, S.PRESETS[0].colors);
  assert.notEqual(fb.colors, S.PRESETS[0].colors);
});

check("GLSL sources are complete and reference every uniform", () => {
  assert.match(S.VERTEX_SRC, /void main\s*\(/);
  assert.match(S.FRAGMENT_SRC, /void main\s*\(/);
  for (const u of [
    "u_colors",
    "u_scale",
    "u_rotation",
    "u_distortion",
    "u_softness",
    "u_grain",
    "u_resolution",
  ]) {
    assert.ok(
      S.FRAGMENT_SRC.includes(u),
      `fragment shader references ${u}`,
    );
  }
  // WebGL1 GLSL: no version directive, no GLSL3 syntax.
  assert.ok(!S.FRAGMENT_SRC.includes("#version"));
  assert.ok(!S.VERTEX_SRC.includes("#version"));
});

check("defaultShader matches the first preset, as a copy", () => {
  const d = S.defaultShader();
  assert.equal(d.preset, S.PRESETS[0].name);
  assert.deepEqual(d.colors, S.PRESETS[0].colors);
  assert.deepEqual(d.params, S.PRESETS[0].params);
  assert.notEqual(d.colors, S.PRESETS[0].colors);
});

console.log(`${passed} shader checks passed`);
