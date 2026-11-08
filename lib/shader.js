/**
 * Shader layers (M5) — our own mesh-gradient effect, rendered by a small
 * WebGL1 program (components/ShaderNode.jsx) inside the DOM renderer:
 * the "WebGL island" of Phase 5 §3/§9.
 *
 * The effect, in plain terms: four colour anchors sit near the corners
 * of the node; every pixel blends the four colours by a gaussian falloff
 * from those anchors, after the sample field has been rotated, scaled,
 * and pushed around by a few octaves of value noise (fbm) so the colour
 * regions melt into each other instead of forming hard cells. A final
 * hash-noise grain pass keeps large soft areas from banding.
 *
 * The GLSL below is original to this project (written for M5), as are
 * the preset names and values — it is a *similar concept* to other
 * tools' mesh gradients, not a reproduction of anyone's shader code.
 *
 * This module is PURE and import-free (like lib/model.js) so the node
 * test suites can load it standalone: presets, parameter normalisation,
 * uniform packing, and the GLSL sources as string constants.
 */

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * The five shader parameters, in Inspector order. `def` values are the
 * spec'd defaults for a fresh shader node.
 */
export const PARAM_DEFS = [
  { key: "scale", label: "Scale", min: 0.5, max: 3, def: 1, step: 0.05 },
  { key: "rotation", label: "Rotation", min: 0, max: 360, def: 0, step: 1 },
  { key: "distortion", label: "Distortion", min: 0, max: 100, def: 35, step: 1 },
  { key: "softness", label: "Softness", min: 0, max: 100, def: 60, step: 1 },
  { key: "grain", label: "Grain", min: 0, max: 100, def: 12, step: 1 },
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function finiteOr(v, def) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Clamp a params record to the PARAM_DEFS ranges, filling gaps with the
 * defaults. Always returns a fresh object with exactly the five keys.
 * @param {Object} [params]
 */
export function normalizeParams(params) {
  const out = {};
  for (const d of PARAM_DEFS) {
    out[d.key] = clamp(finiteOr(params?.[d.key], d.def), d.min, d.max);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** Padding colours for a shader stored with fewer than four colours. */
const FALLBACK_COLORS = ["#3B82F6", "#8B5CF6", "#EC4899", "#F5A623"];

/**
 * Exactly four colour strings: the node's own first, then fallbacks for
 * missing/non-string slots. Values are passed through untouched (the
 * editor stores hex; anything else degrades in hexToRgb).
 * @param {string[]} [colors]
 * @returns {string[]} length 4
 */
export function normalizeShaderColors(colors) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const c = Array.isArray(colors) ? colors[i] : undefined;
    out.push(typeof c === "string" && c !== "" ? c : FALLBACK_COLORS[i]);
  }
  return out;
}

/**
 * "#rrggbb" (or "#rgb") → [r, g, b] floats in 0..1.
 * Anything unparseable degrades to black rather than throwing.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  if (typeof hex !== "string") return [0, 0, 0];
  const long = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (long) {
    const n = parseInt(long[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const short = /^#([0-9a-f]{3})$/i.exec(hex.trim());
  if (short) {
    return short[1].split("").map((c) => parseInt(c + c, 16) / 255);
  }
  return [0, 0, 0];
}

// ---------------------------------------------------------------------------
// Presets (our own names, colour sets and parameter values)
// ---------------------------------------------------------------------------

export const PRESETS = [
  {
    name: "Aurora Veil",
    colors: ["#14406B", "#1FA8A0", "#8FE3C0", "#5B5BD6"],
    params: { scale: 1.2, rotation: 25, distortion: 55, softness: 80, grain: 10 },
  },
  {
    name: "Ember Drift",
    colors: ["#3D0C02", "#B23A12", "#F07F3C", "#FFC46B"],
    params: { scale: 1, rotation: 140, distortion: 40, softness: 65, grain: 14 },
  },
  {
    name: "Lagoon Haze",
    colors: ["#0A4D68", "#088F8F", "#7FD1D9", "#EDF3DC"],
    params: { scale: 0.8, rotation: 310, distortion: 30, softness: 90, grain: 8 },
  },
  {
    name: "Graphite Bloom",
    colors: ["#1E1E24", "#4A4E69", "#9A8C98", "#F2E9E4"],
    params: { scale: 1.5, rotation: 200, distortion: 65, softness: 55, grain: 18 },
  },
];

/**
 * A fresh, independent shader object for a preset name:
 * `{ preset, colors: [4 hex], params: {...} }`. Unknown names fall back
 * to the first preset. The result shares NOTHING with PRESETS — callers
 * may mutate it freely.
 * @param {string} name
 */
export function applyPreset(name) {
  const found = PRESETS.find((p) => p.name === name) ?? PRESETS[0];
  return {
    preset: found.name,
    colors: [...found.colors],
    params: { ...found.params },
  };
}

/** The shader a freshly created shader node starts with. */
export function defaultShader() {
  return applyPreset(PRESETS[0].name);
}

// ---------------------------------------------------------------------------
// Uniform packing (the bridge to the GLSL below)
// ---------------------------------------------------------------------------

/**
 * Pack a stored shader into GL-ready uniforms:
 * `{ colors: [[r,g,b] × 4] (0..1 floats), scale, rotationRad,
 *    distortion, softness, grain }` — the last three normalised to 0..1.
 * @param {Object} [shader] A node.shader value (may be partial/absent).
 */
export function buildUniforms(shader) {
  const params = normalizeParams(shader?.params);
  return {
    colors: normalizeShaderColors(shader?.colors).map(hexToRgb),
    scale: params.scale,
    rotationRad: (params.rotation * Math.PI) / 180,
    distortion: params.distortion / 100,
    softness: params.softness / 100,
    grain: params.grain / 100,
  };
}

// ---------------------------------------------------------------------------
// GLSL — original to this project. WebGL1 / GLSL ES 1.00: no #version,
// no dynamic indexing beyond constant expressions.
// ---------------------------------------------------------------------------

export const VERTEX_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAGMENT_SRC = `
precision mediump float;

varying vec2 v_uv;

uniform vec3 u_colors[4];
uniform float u_scale;
uniform float u_rotation;
uniform float u_distortion;
uniform float u_softness;
uniform float u_grain;
uniform vec2 u_resolution;

// --- a small value-noise kit -------------------------------------------
// hash21: one hash from a 2D point, used for both the smooth noise and
// the per-pixel grain. vnoise interpolates hashes on a lattice with the
// classic smoothstep curve; fbm stacks three octaves of it.
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Work in an aspect-corrected space so the colour blobs stay round
  // on non-square nodes.
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 centre = vec2(0.5 * aspect, 0.5);
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);

  // Rotate the whole colour field around the centre.
  float ca = cos(u_rotation);
  float sa = sin(u_rotation);
  p = centre + mat2(ca, -sa, sa, ca) * (p - centre);

  // Scale zooms the field around the centre (anchors live in the same
  // space, so the whole gradient breathes in and out).
  vec2 q = centre + (p - centre) * u_scale;

  // Domain warp: two fbm samples push the lookup point around, so the
  // colour regions bleed into each other like ink in water.
  float w1 = fbm(q * 1.8 + vec2(4.7, 2.3));
  float w2 = fbm(q * 1.8 + vec2(9.2, 6.8));
  q += (vec2(w1, w2) - 0.5) * u_distortion * 1.4;

  // Four colour anchors, one near each corner.
  vec2 a0 = vec2(0.10 * aspect, 0.12);
  vec2 a1 = vec2(0.90 * aspect, 0.18);
  vec2 a2 = vec2(0.84 * aspect, 0.88);
  vec2 a3 = vec2(0.16 * aspect, 0.82);

  // Gaussian falloff from each anchor. Softness drives the spread:
  // low softness = tight, saturated pools of colour; high softness =
  // a broad, gentle wash.
  float spread = mix(26.0, 3.2, u_softness);
  float w0 = exp(-dot(q - a0, q - a0) * spread);
  float w1g = exp(-dot(q - a1, q - a1) * spread);
  float w2g = exp(-dot(q - a2, q - a2) * spread);
  float w3 = exp(-dot(q - a3, q - a3) * spread);

  float total = w0 + w1g + w2g + w3 + 0.00001;
  vec3 color = (
    u_colors[0] * w0 +
    u_colors[1] * w1g +
    u_colors[2] * w2g +
    u_colors[3] * w3
  ) / total;

  // Fine film grain from the pixel hash — keeps the soft areas alive
  // and breaks up gradient banding.
  float g = hash21(gl_FragCoord.xy) - 0.5;
  color += g * u_grain * 0.30;

  gl_FragColor = vec4(color, 1.0);
}
`;
