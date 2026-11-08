/**
 * Standalone checks for SVG export and fillRule handling.
 * Run with: node scripts/svg-test.mjs
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

const C = await load("../lib/codegen.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const svgDoc = {
  tokens: [],
  nodes: {
    "svg-root": {
      id: "svg-root",
      type: "svg",
      name: "LinkedIn Logo",
      parentId: null,
      childIds: ["group-layer1"],
      viewBox: "0 0 800 200",
      size: { w: { px: 800 }, h: { px: 200 } },
      position: { x: 0, y: 0 },
    },
    "group-layer1": {
      id: "group-layer1",
      type: "group",
      name: "Layer 1",
      parentId: "svg-root",
      childIds: ["path-in", "path-dot"],
      transform: "matrix(3,0,0,3,0,0)",
    },
    "path-in": {
      id: "path-in",
      type: "path",
      name: "Path1903",
      parentId: "group-layer1",
      childIds: [],
      d: "M82 0 L64 0 Z M66 18 L69 18 Z",
      fillRule: "evenodd",
      style: {
        fill: { kind: "solid", color: "#000000" },
      },
    },
    "path-dot": {
      id: "path-dot",
      type: "path",
      name: "Path1907",
      parentId: "group-layer1",
      childIds: [],
      d: "M60 18 L57 18 Z",
      fillRule: "nonzero",
      style: {
        fill: { kind: "solid", color: "#000000" },
      },
    },
  },
};

check("SVG export in React includes groups and fillRule=evenodd", () => {
  const code = C.nodeToReact(svgDoc.nodes["svg-root"], svgDoc);
  assert.ok(code.includes('viewBox="0 0 800 200"'), "viewBox is preserved");
  assert.ok(code.includes('<g transform="matrix(3,0,0,3,0,0)">'), "group and transform are preserved");
  assert.ok(code.includes('fillRule="evenodd"'), "fillRule='evenodd' is emitted on path");
});

check("SVG export in HTML includes fill-rule=evenodd", () => {
  const html = C.nodeToHtmlDocument(svgDoc.nodes["svg-root"], svgDoc);
  assert.ok(html.includes('viewBox="0 0 800 200"'), "HTML has viewBox");
  assert.ok(html.includes('fill-rule="evenodd"'), "HTML has fill-rule='evenodd'");
  assert.ok(html.includes('<g transform="matrix(3,0,0,3,0,0)">'), "HTML has group and transform");
});

check("SVG export in Tailwind JSX includes fillRule", () => {
  const jsx = C.nodeToTailwind(svgDoc.nodes["svg-root"], svgDoc);
  assert.ok(jsx.includes('fillRule="evenodd"'), "Tailwind JSX has fillRule");
});

check("SVG export in React JSX includes fillRule and groups", () => {
  const jsx = C.nodeToReactJsx(svgDoc.nodes["svg-root"], svgDoc);
  assert.ok(jsx.includes('fillRule="evenodd"'), "React JSX has fillRule");
  assert.ok(jsx.includes('<g transform="matrix(3,0,0,3,0,0)">'), "React JSX has group");
});

check("SVG export in React TSX includes fillRule and groups", () => {
  const tsx = C.nodeToReactTsx(svgDoc.nodes["svg-root"], svgDoc);
  assert.ok(tsx.includes('fillRule="evenodd"'), "React TSX has fillRule");
  assert.ok(tsx.includes('<g transform="matrix(3,0,0,3,0,0)">'), "React TSX has group");
});

check("SVG export in Astro includes fill-rule and groups", () => {
  const astro = C.nodeToAstro(svgDoc.nodes["svg-root"], svgDoc);
  assert.ok(astro.includes('fill-rule="evenodd"'), "Astro has fill-rule");
  assert.ok(astro.includes('<g transform="matrix(3,0,0,3,0,0)">'), "Astro has group");
});

console.log(`\n${passed} SVG checks passed`);
