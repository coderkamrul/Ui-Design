/**
 * Standalone checks for lib/ai.js (platform batch — procedural AI
 * Create) — run with: node scripts/ai-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern
 * as the other suites: the package has no "type": "module"). ai.js is
 * import-free precisely so this works.
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

const { hashPrompt, mulberry32, promptPalette, generateSvg } = await load(
  "../lib/ai.js",
);

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

// -- hash + PRNG determinism -------------------------------------------
ok(hashPrompt("sunset") === hashPrompt("sunset"), "hashPrompt is deterministic");
ok(hashPrompt("sunset") !== hashPrompt("ocean"), "hashPrompt differs per prompt");
ok(
  Number.isInteger(hashPrompt("anything")) && hashPrompt("anything") >= 0,
  "hashPrompt returns an unsigned integer",
);
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  checks++;
  ok(seqA.every((v) => v >= 0 && v < 1), "mulberry32 stays in [0, 1)");
  ok(mulberry32(43)() !== seqA[0], "mulberry32 differs per seed");
}

// -- palette routing -----------------------------------------------------
const families = [
  ["a calm sunset over the hills", "Sunset"],
  ["deep ocean waves at noon", "Ocean"],
  ["forest path through the woods", "Forest"],
  ["desert dunes at midday", "Desert"],
  ["night sky full of stars", "Night sky"],
  ["neon city skyline", "City neon"],
  ["flower garden in bloom", "Blossom"],
  ["an abstract composition", "Open sky"], // default
  ["", "Open sky"], // empty → default palette
];
for (const [prompt, name] of families) {
  const pal = promptPalette(prompt);
  ok(pal.name === name, `palette for ${JSON.stringify(prompt)} → ${name}`);
  ok(
    Array.isArray(pal.stops) &&
      pal.stops.length === 4 &&
      pal.stops.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)),
    `palette for ${JSON.stringify(prompt)} → 4 hex stops`,
  );
  ok(/^#[0-9a-fA-F]{6}$/.test(pal.accent), `palette for ${JSON.stringify(prompt)} → hex accent`);
}

// -- generateSvg ---------------------------------------------------------
const svg1 = generateSvg("sunset over mountain ridges", { w: 800, h: 600 });
const svg2 = generateSvg("sunset over mountain ridges", { w: 800, h: 600 });
ok(svg1 === svg2, "generateSvg: same prompt + size → identical string");
ok(
  generateSvg("ocean waves", { w: 800, h: 600 }) !== svg1,
  "generateSvg: different prompt → different SVG",
);
ok(
  generateSvg("sunset over mountain ridges", { w: 1024, h: 768 }) !== svg1,
  "generateSvg: different size → recomposed SVG",
);
ok(svg1.startsWith("<svg"), "generateSvg: starts with <svg");
ok(svg1.trimEnd().endsWith("</svg>"), "generateSvg: closes with </svg>");
ok(
  svg1.includes('width="800"') && svg1.includes('height="600"'),
  "generateSvg: size honoured in width/height",
);
ok(
  svg1.includes('viewBox="0 0 800 600"'),
  "generateSvg: size honoured in viewBox",
);
{
  const pal = promptPalette("sunset over mountain ridges");
  ok(
    pal.stops.every((c) => svg1.includes(c)),
    "generateSvg: contains every palette stop",
  );
}
// Motif spot checks: each family produces its signature shapes.
ok(
  generateSvg("flower meadow", { w: 800, h: 600 }).includes("<ellipse"),
  "flower prompt → petal ellipses",
);
ok(
  generateSvg("ocean waves", { w: 800, h: 600 }).includes("<path"),
  "ocean prompt → wave paths",
);
ok(
  generateSvg("mountain peaks", { w: 800, h: 600 }).includes("<polygon"),
  "mountain prompt → ridge polygons",
);
ok(
  typeof generateSvg("", { w: 640, h: 480 }) === "string" &&
    generateSvg("", { w: 640, h: 480 }).includes('viewBox="0 0 640 480"'),
  "empty prompt → fallback sky at the requested size",
);
ok(
  generateSvg("zzz qqq", { w: 800, h: 600 }) ===
    generateSvg("zzz qqq", { w: 800, h: 600 }),
  "unmatched prompt → deterministic blobs",
);

console.log(`\n${checks} ai checks passed`);
