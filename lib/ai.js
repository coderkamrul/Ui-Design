/**
 * AI Create — PROCEDURAL generation (platform batch).
 *
 * Import-free on purpose, like lib/versions.js and lib/plans.js, so
 * scripts/ai-test.mjs can load this file directly under node.
 *
 * HONEST LABELLING: despite the toolbar name ("Create image" /
 * "Create SVG", inherited from the product spec), nothing here calls
 * an AI model. Generation is a seeded, deterministic composition
 * engine that runs entirely in the browser: the prompt selects a
 * palette and a motif family by keyword, and a PRNG seeded from the
 * prompt arranges the shapes. Same prompt + same size → byte-identical
 * SVG, every time. The UI carries the label "Procedural generation —
 * runs locally, no external AI model", and the README documents the
 * future provider hook (an AI_IMAGE_API_URL the panel would POST to);
 * that network call is deliberately NOT implemented.
 */

/**
 * FNV-1a 32-bit hash of a string (same family as lib/collab.js's
 * hashId, kept local so this module stays import-free).
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function hashPrompt(str) {
  const s = String(str ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — a tiny, fast, seedable PRNG. Returns a function
 * producing floats in [0, 1). Deterministic per seed.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===========================================================================
// Palettes — keyword routing. Each palette: 4 gradient stops (top →
// horizon) plus an accent for discs / highlights / focal shapes.
// ===========================================================================

const PALETTES = [
  {
    family: "flower",
    keywords: ["flower", "floral", "bloom", "petal", "rose", "tulip", "blossom", "spring", "daisy", "orchid"],
    name: "Blossom",
    stops: ["#FDE8F1", "#FBCFE3", "#F9A8C9", "#E8E3F5"],
    accent: "#E2547A",
  },
  {
    family: "night",
    keywords: ["night", "midnight", "moon", "star", "galaxy", "space", "cosmos", "dark", "dream"],
    name: "Night sky",
    stops: ["#0B1030", "#1B2450", "#2E3A6E", "#4A5B9E"],
    accent: "#F5D98B",
  },
  {
    family: "ocean",
    keywords: ["ocean", "sea", "wave", "beach", "coast", "water", "marine", "underwater", "surf", "lagoon"],
    name: "Ocean",
    stops: ["#DFF5F2", "#A8E0DA", "#4FB3B0", "#1D6E79"],
    accent: "#FF8A5C",
  },
  {
    family: "desert",
    keywords: ["desert", "sand", "dune", "sahara", "canyon", "mesa", "oasis", "arid"],
    name: "Desert",
    stops: ["#FDF0D5", "#FAD9A0", "#F0A868", "#C96F3B"],
    accent: "#8C4A2F",
  },
  {
    family: "forest",
    keywords: ["forest", "jungle", "tree", "woods", "nature", "garden", "leaf", "moss", "fern", "meadow"],
    name: "Forest",
    stops: ["#EAF6E3", "#BFE3B4", "#6FBF73", "#2F6B3A"],
    accent: "#F2C14E",
  },
  {
    family: "city",
    keywords: ["city", "urban", "neon", "cyber", "skyline", "street", "downtown", "tokyo", "grid", "geometric"],
    name: "City neon",
    stops: ["#141428", "#23234A", "#3B2F63", "#6C3FA0"],
    accent: "#2DE2E6",
  },
  {
    family: "sunset",
    keywords: ["sunset", "sunrise", "dusk", "dawn", "evening", "golden", "twilight", "ember"],
    name: "Sunset",
    stops: ["#FFE8C9", "#FFB26B", "#F27059", "#7A3B69"],
    accent: "#FFD93D",
  },
];

const DEFAULT_PALETTE = {
  family: "meadow",
  name: "Open sky",
  stops: ["#E8F3FF", "#BFDFFF", "#8FC1F5", "#5B8DEF"],
  accent: "#FFB020",
};

/** Which palette family a prompt routes to (first keyword hit wins,
 *  families in the PALETTES order above — flower before forest, night
 *  before city, so "moonlit garden" reads as night). */
function paletteFamily(prompt) {
  const text = String(prompt ?? "").toLowerCase();
  for (const p of PALETTES) {
    if (p.keywords.some((k) => text.includes(k))) return p;
  }
  return DEFAULT_PALETTE;
}

/**
 * The palette for a prompt: { name, stops: [hex × 4], accent, family }.
 * `family` is the routing key generateSvg picks its motif by (and the
 * UI ignores it — it shows name + stop swatches).
 * @param {string} prompt
 */
export function promptPalette(prompt) {
  const p = paletteFamily(prompt);
  return { name: p.name, stops: [...p.stops], accent: p.accent, family: p.family };
}

// ===========================================================================
// SVG composition
// ===========================================================================

/** Round to 1 decimal — keeps the output compact and stable. */
const f1 = (n) => Math.round(n * 10) / 10;

function range(rng, min, max) {
  return min + rng() * (max - min);
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** A layered mountain ridge: a jagged polygon from a seeded walk. */
function ridge(rng, w, h, baseY, amp, color, opacity) {
  const steps = 8;
  const pts = [`0,${f1(h)}`];
  for (let i = 0; i <= steps; i++) {
    const x = (w / steps) * i;
    const y = baseY - rng() * amp - (i === 0 || i === steps ? amp * 0.3 : 0);
    pts.push(`${f1(x)},${f1(y)}`);
  }
  pts.push(`${f1(w)},${f1(h)}`);
  return `<polygon points="${pts.join(" ")}" fill="${color}" opacity="${opacity}"/>`;
}

function motifMountains(rng, w, h, pal, celestial) {
  const cx = range(rng, w * 0.25, w * 0.75);
  const cy = range(rng, h * 0.2, h * 0.38);
  const r = range(rng, h * 0.07, h * 0.11);
  const disc = celestial
    ? `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 1.9)}" fill="${pal.accent}" opacity="0.25"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${pal.accent}"/>`
    : "";
  return (
    disc +
    ridge(rng, w, h, h * 0.62, h * 0.16, pal.stops[2], 0.55) +
    ridge(rng, w, h, h * 0.78, h * 0.14, pal.stops[3], 0.8) +
    ridge(rng, w, h, h * 0.94, h * 0.1, pal.stops[3], 1)
  );
}

function motifWaves(rng, w, h, pal) {
  let out = "";
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const baseY = h * (0.34 + i * 0.17);
    const amp = range(rng, h * 0.03, h * 0.07);
    const phase = rng() * Math.PI * 2;
    const seg = w / 4;
    let d = `M0,${f1(baseY)}`;
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const x1 = seg * sIdx + seg * 0.33;
      const x2 = seg * sIdx + seg * 0.66;
      const x3 = seg * (sIdx + 1);
      const y1 = baseY + Math.sin(phase + sIdx * 1.7) * amp;
      const y2 = baseY + Math.cos(phase + sIdx * 1.3) * amp;
      d += ` C${f1(x1)},${f1(y1)} ${f1(x2)},${f1(y2)} ${f1(x3)},${f1(baseY)}`;
    }
    d += ` L${f1(w)},${f1(h)} L0,${f1(h)} Z`;
    out += `<path d="${d}" fill="${pal.stops[Math.min(3, i + 1)]}" opacity="${f1(0.45 + i * 0.18)}"/>`;
  }
  const sunX = range(rng, w * 0.2, w * 0.8);
  out =
    `<circle cx="${f1(sunX)}" cy="${f1(h * 0.2)}" r="${f1(h * 0.06)}" fill="${pal.accent}" opacity="0.9"/>` +
    out;
  return out;
}

function motifBlobs(rng, w, h, pal) {
  let out = "";
  const count = 6 + Math.floor(rng() * 4);
  const colors = [pal.stops[1], pal.stops[2], pal.stops[3], pal.accent];
  for (let i = 0; i < count; i++) {
    const cx = range(rng, w * 0.08, w * 0.92);
    const cy = range(rng, h * 0.12, h * 0.9);
    const r = range(rng, h * 0.06, h * 0.24);
    out += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${pick(rng, colors)}" opacity="${f1(range(rng, 0.25, 0.6))}"/>`;
  }
  const fx = range(rng, w * 0.3, w * 0.7);
  const fy = range(rng, h * 0.3, h * 0.6);
  out += `<circle cx="${f1(fx)}" cy="${f1(fy)}" r="${f1(h * 0.05)}" fill="${pal.accent}"/>`;
  return out;
}

function motifGrid(rng, w, h, pal) {
  const cols = 6;
  const rows = Math.max(3, Math.round(cols * (h / w)));
  const cw = w / cols;
  const ch = h / rows;
  const colors = [pal.stops[1], pal.stops[2], pal.stops[3], pal.accent];
  let out = "";
  for (let rI = 0; rI < rows; rI++) {
    for (let cI = 0; cI < cols; cI++) {
      const roll = rng();
      const color = pick(rng, colors);
      const x = cI * cw;
      const y = rI * ch;
      if (roll < 0.3) {
        out += `<circle cx="${f1(x + cw / 2)}" cy="${f1(y + ch / 2)}" r="${f1(Math.min(cw, ch) * range(rng, 0.18, 0.42))}" fill="${color}" opacity="${f1(range(rng, 0.5, 1))}"/>`;
      } else if (roll < 0.55) {
        const inset = range(rng, 0.08, 0.3);
        out += `<rect x="${f1(x + cw * inset)}" y="${f1(y + ch * inset)}" width="${f1(cw * (1 - inset * 2))}" height="${f1(ch * (1 - inset * 2))}" fill="${color}" opacity="${f1(range(rng, 0.4, 0.9))}"/>`;
      } else if (roll < 0.7) {
        out += `<polygon points="${f1(x)},${f1(y + ch)} ${f1(x + cw)},${f1(y + ch)} ${f1(x + cw)},${f1(y)}" fill="${color}" opacity="${f1(range(rng, 0.35, 0.8))}"/>`;
      }
    }
  }
  return out;
}

function motifPetals(rng, w, h, pal) {
  let out = "";
  const flowers = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < flowers; i++) {
    const cx = range(rng, w * 0.18, w * 0.82);
    const cy = range(rng, h * 0.25, h * 0.62);
    const petalLen = range(rng, h * 0.09, h * 0.16);
    const petalWid = petalLen * 0.45;
    const petals = 6 + Math.floor(rng() * 3);
    const petalColor = pick(rng, [pal.stops[2], pal.stops[1], pal.accent]);
    // Stem down to the ground line.
    out += `<path d="M${f1(cx)},${f1(cy)} C${f1(cx + petalLen * 0.2)},${f1(cy + petalLen * 1.2)} ${f1(cx - petalLen * 0.2)},${f1(cy + petalLen * 1.8)} ${f1(cx)},${f1(h * 0.98)}" stroke="${pal.stops[3]}" stroke-width="${f1(Math.max(2, h * 0.008))}" fill="none" opacity="0.8"/>`;
    for (let p = 0; p < petals; p++) {
      const angle = (360 / petals) * p + rng() * 12;
      out += `<ellipse cx="${f1(cx)}" cy="${f1(cy - petalLen / 2)}" rx="${f1(petalWid)}" ry="${f1(petalLen / 2)}" fill="${petalColor}" opacity="0.85" transform="rotate(${f1(angle)} ${f1(cx)} ${f1(cy)})"/>`;
    }
    out += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(petalLen * 0.22)}" fill="${pal.accent}"/>`;
  }
  // Ground band.
  out += `<rect x="0" y="${f1(h * 0.94)}" width="${f1(w)}" height="${f1(h * 0.06)}" fill="${pal.stops[3]}" opacity="0.5"/>`;
  return out;
}

function motifSky(rng, w, h, pal) {
  // Fallback composition: gradient sky + drifting soft shapes + a
  // horizon band. Used for empty prompts.
  let out = "";
  for (let i = 0; i < 5; i++) {
    const cx = range(rng, w * 0.1, w * 0.9);
    const cy = range(rng, h * 0.1, h * 0.45);
    const r = range(rng, h * 0.05, h * 0.13);
    out += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="#FFFFFF" opacity="${f1(range(rng, 0.25, 0.55))}"/>`;
  }
  out += `<circle cx="${f1(w * 0.78)}" cy="${f1(h * 0.22)}" r="${f1(h * 0.07)}" fill="${pal.accent}"/>`;
  out += `<rect x="0" y="${f1(h * 0.82)}" width="${f1(w)}" height="${f1(h * 0.18)}" fill="${pal.stops[3]}" opacity="0.65"/>`;
  return out;
}

/**
 * Generate a complete, original SVG document for a prompt.
 *
 * Deterministic: the seed is hashPrompt(`${prompt}|${w}x${h}`), so the
 * same prompt at the same size always yields the identical string —
 * and a different size legitimately recomposes the scene.
 *
 * Motif routing (keyword families): flower → petals; ocean → waves;
 * city / geometric → grid; mountain/sunset/night keywords → ridges
 * with a sun/moon disc; empty prompt → gradient-sky fallback;
 * anything else → soft blobs.
 *
 * @param {string} prompt
 * @param {{ w?: number, h?: number }} [size]
 * @returns {string} a full `<svg …>…</svg>` document
 */
export function generateSvg(prompt, { w = 800, h = 600 } = {}) {
  const width = Math.max(16, Math.round(w) || 800);
  const height = Math.max(16, Math.round(h) || 600);
  const text = String(prompt ?? "");
  const lower = text.toLowerCase();
  const pal = promptPalette(text);
  const rng = mulberry32(hashPrompt(`${text}|${width}x${height}`));

  let motif;
  if (!lower.trim()) {
    motif = motifSky(rng, width, height, pal);
  } else if (pal.family === "flower") {
    motif = motifPetals(rng, width, height, pal);
  } else if (pal.family === "ocean") {
    motif = motifWaves(rng, width, height, pal);
  } else if (pal.family === "city") {
    motif = motifGrid(rng, width, height, pal);
  } else if (
    pal.family === "night" ||
    pal.family === "sunset" ||
    pal.family === "desert" ||
    /mountain|peak|ridge|alpine|hill|volcano/.test(lower)
  ) {
    motif = motifMountains(
      rng,
      width,
      height,
      pal,
      pal.family === "night" || pal.family === "sunset",
    );
  } else {
    motif = motifBlobs(rng, width, height, pal);
  }

  const stops = pal.stops
    .map(
      (color, i) =>
        `<stop offset="${Math.round((i / (pal.stops.length - 1)) * 100)}%" stop-color="${color}"/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#sky)"/>` +
    motif +
    `</svg>`
  );
}
