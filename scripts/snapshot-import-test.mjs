// scripts/snapshot-import-test.mjs — lib/snapshot-import.js: clipboard
// classification, the HTML→node converter (fix-ups, walk, style
// conversion, positioning, post-passes), and image-job resolution.
// Fixture: Md's real snapshot payload (../user/files/clipboard_data.txt).
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyClipboard, looksLikeSvg, extractPaperHtml,
  parseStyleAttribute, parseColor, parseGradient, parseBorders,
  collapseWhitespace, isBigPaste,
  parseHtmlFragment, flattenElements, parseStyleAttribute as parseStyle,
  convertHtml, resolveImportedImages,
  formatNodeForCanvasTool, mapObjectFit,
} from "../lib/snapshot-import.js";

let passed = 0;
const check = (name, fn) => {
  const r = fn();
  if (r && typeof r.then === "function") {
    return r.then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    });
  }
  passed += 1;
  console.log(`ok - ${name}`);
  return Promise.resolve();
};

const checks = [];
const test = (name, fn) => checks.push(() => check(name, fn));

test("classifier order: SVG text beats files and HTML", () => {
  const cls = classifyClipboard({
    text: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    html: "<x-paper-html><div></div></x-paper-html>",
    files: [{ type: "image/png" }],
  });
  assert.equal(cls.kind, "svg");
  assert.equal(looksLikeSvg('<?xml version="1.0"?><svg></svg>'), true);
  assert.equal(looksLikeSvg("<svgx>"), false);
});

test("classifier order: image files beat x-paper-html; snapshot extraction", () => {
  const withFiles = classifyClipboard({
    html: "<x-paper-html><div></div></x-paper-html>",
    files: [{ type: "image/png" }, { type: "text/plain" }],
  });
  assert.equal(withFiles.kind, "files");
  assert.equal(withFiles.files.length, 1);
  const snap = classifyClipboard({
    html: "<!--StartFragment--><x-paper-html><div>inner</div></x-paper-html><!--EndFragment-->",
  });
  assert.equal(snap.kind, "html");
  assert.equal(snap.source, "snapshot");
  assert.equal(snap.html, "<div>inner</div>");
  assert.equal(extractPaperHtml("<div>no wrapper</div>"), null);
});

test("classifier: HTML-looking text, other HTML, plain text, none", () => {
  assert.equal(classifyClipboard({ text: "  <div>hi</div>" }).source, "text");
  assert.equal(classifyClipboard({ html: "<html><body><p>x</p></body></html>" }).source, "html");
  const plain = classifyClipboard({ text: "just words" });
  assert.equal(plain.kind, "text");
  assert.equal(classifyClipboard({}).kind, "none");
  assert.equal(classifyClipboard({ text: "   " }).kind, "none");
});

test("style tokenizer respects parens, quotes and semicolons inside values", () => {
  const s = parseStyleAttribute(
    'background-image: url("a;b.png"); color: rgb(1, 2, 3); font-family: Inter, "Inter Fallback"; width: 10px !important',
  );
  assert.equal(s["background-image"], 'url("a;b.png")');
  assert.equal(s.color, "rgb(1, 2, 3)");
  assert.equal(s["font-family"], 'Inter, "Inter Fallback"');
  assert.equal(s.width, "10px");
});

test("parseColor: rgb/rgba/hex/oklch/oklab/transparent", () => {
  assert.deepEqual(parseColor("rgb(10, 20, 30)"), { hex: "#0A141E", opacity: 100 });
  assert.deepEqual(parseColor("rgba(255, 0, 0, 0.5)"), { hex: "#FF0000", opacity: 50 });
  assert.deepEqual(parseColor("#0f0"), { hex: "#00FF00", opacity: 100 });
  assert.deepEqual(parseColor("transparent"), { hex: "#000000", opacity: 0 });
  const okl = parseColor("oklch(0.5 0.1 180)");
  assert.ok(okl && /^#[0-9A-F]{6}$/.test(okl.hex));
  const lab = parseColor("oklab(0.5 0.05 -0.05)");
  assert.ok(lab && /^#[0-9A-F]{6}$/.test(lab.hex));
  assert.equal(parseColor("not-a-color"), null);
});

test("gradient + border parsing", () => {
  const g = parseGradient("linear-gradient(90deg, rgb(255, 0, 0) 0%, #0000FF 100%)");
  assert.equal(g.kind, "linear");
  assert.equal(g.angle, 90);
  assert.deepEqual(g.stops.map((s) => s.at), [0, 100]);
  assert.equal(g.stops[0].color, "#FF0000");
  const borders = parseBorders(parseStyle("border: 2px solid rgb(1, 2, 3)"));
  assert.equal(borders.length, 4);
  assert.equal(borders[0].width, 2);
  assert.equal(borders[0].color, "#010203");
});

test("whitespace collapsing modes", () => {
  assert.equal(collapseWhitespace("a  \n\t b", ""), "a b");
  assert.equal(collapseWhitespace("a  b\n c", "pre"), "a  b\n c");
  assert.equal(collapseWhitespace("a   b\nc  d", "pre-line"), "a b\nc d");
});

test("content-box correction widens px sizes by padding + border", () => {
  const res = convertHtml(
    '<div style="box-sizing: content-box; width: 100px; height: 50px; padding: 10px; border: 5px solid #000000"></div>',
  );
  assert.equal(res.roots[0].w, 130);
  assert.equal(res.roots[0].h, 80);
});

test("form controls become frames with a text child (value, else placeholder at 50%)", () => {
  const res = convertHtml('<input value="Hello" style="width: 120px; height: 30px">');
  const frame = res.roots[0];
  assert.equal(frame.type, "frame");
  assert.equal(frame.name, "Input");
  assert.equal(frame.childIds.length, 1);
  const child = res.byId.get(frame.childIds[0]);
  assert.equal(child.type, "text");
  assert.equal(child.text.content, "Hello");
  const ph = convertHtml('<input placeholder="Search…" style="width: 120px; height: 30px">');
  const phChild = ph.byId.get(ph.roots[0].childIds[0]);
  assert.equal(phChild.text.content, "Search…");
  assert.equal(phChild.opacity, 50);
});

test("text collapse: one node per all-text subtree, whitespace collapsed", () => {
  const res = convertHtml("<p>Hello   <strong>bold</strong>\n   world</p>");
  assert.equal(res.roots.length, 1);
  assert.equal(res.roots[0].type, "text");
  assert.equal(res.roots[0].text.content, "Hello bold world");
  const pre = convertHtml("<pre>a  b\n c</pre>");
  assert.equal(pre.roots[0].text.content, "a  b\n c");
});

test("absolute elements keep their direct DOM parent hierarchy with absolute positioning", () => {
  const res = convertHtml(
    '<div style="position: relative; width: 200px; height: 200px">' +
      '<div id="direct-parent"><span style="position: absolute; left: 10px; top: 20px; width: 30px; height: 40px"></span></div>' +
      "</div>",
  );
  const directParent = res.all.find((n) => n.id !== res.roots[0].id && n.childIds?.length > 0);
  const abs = res.all.find((n) => n.absolutePosition);
  assert.ok(abs);
  assert.equal(abs.parentId, directParent.id);
  assert.equal(abs.x, 10);
  assert.equal(abs.y, 20);
  const fixed = convertHtml('<div style="width: 100px; height: 100px"><div style="position: fixed; top: 0px; left: 0px; width: 10px; height: 10px"></div></div>');
  assert.equal(fixed.all.filter((n) => n.absolutePosition).length, 1);
});

test("flex gap recovery from uniform child margins", () => {
  const kid = (margin) =>
    `<div style="width: 50px; height: 20px${margin ? `; margin-left: ${margin}` : ""}"></div>`;
  const res = convertHtml(
    `<div style="display: flex; flex-direction: row; width: 300px; height: 40px">${kid()}${kid("12px")}${kid("12px")}</div>`,
  );
  assert.equal(res.roots[0].flex.gap.value, 12);
});

test("DOM child order is preserved; z-index is kept in rawStyle without corrupting DOM order", () => {
  const kid = (z, w) => `<div style="z-index: ${z}; width: ${w}px; height: 10px"></div>`;
  const res = convertHtml(`<div style="width: 100px; height: 100px">${kid(3, 30)}${kid(1, 10)}${kid(2, 20)}</div>`);
  const widths = res.roots[0].childIds.map((id) => res.byId.get(id).w);
  assert.deepEqual(widths, [30, 10, 20]);
});

test("grid containers flatten: children placed by the template", () => {
  const kid = '<div style="width: 50px; height: 20px"></div>';
  const res = convertHtml(
    `<div style="display: grid; grid-template-columns: repeat(2, 1fr); width: 200px; height: 100px">${kid}${kid}${kid}</div>`,
  );
  const kids = res.roots[0].childIds.map((id) => res.byId.get(id));
  assert.deepEqual(kids.map((k) => [k.x, k.y]), [[0, 0], [100, 0], [0, 20]]);
  assert.equal(res.stats.grids, 1);
});

test("block flow stacks children with margins", () => {
  const res = convertHtml(
    '<div style="width: 200px"><div style="height: 30px"></div><div style="height: 40px; margin-top: 10px"></div></div>',
  );
  const kids = res.roots[0].childIds.map((id) => res.byId.get(id));
  assert.equal(kids[1].y, 40);
});

test("video placeholder, layer-name cap, locked + hidden flags, rawStyle bag", () => {
  const v = convertHtml('<video style="width: 300px; height: 200px"></video>');
  assert.equal(v.roots[0].videoPlaceholder, true);
  assert.equal(v.roots[0].w, 300);
  const named = convertHtml(`<div layer-name="${"x".repeat(250)}" data-paper-locked style="width: 10px; height: 10px"></div>`);
  assert.equal(named.roots[0].name.length, 200);
  assert.equal(named.roots[0].locked, true);
  const hidden = convertHtml('<div style="display: none; width: 5px; height: 5px"></div>');
  assert.equal(hidden.roots[0].hidden, true);
  const raw = convertHtml('<div style="width: 10px; height: 10px; min-width: 5px; transform: translateX(4px)"></div>');
  assert.equal(raw.roots[0].rawStyle["min-width"], "5px");
  assert.ok(raw.roots[0].rawStyle.transform.includes("translateX"));
});

test("big-paste thresholds", () => {
  assert.equal(isBigPaste({ htmlLength: 100000 }), true);
  assert.equal(isBigPaste({ nodeCount: 500 }), true);
  assert.equal(isBigPaste({ htmlLength: 99999, nodeCount: 499 }), false);
});

test("image jobs: failures strip the source, successes land, data: untouched", async () => {
  const res = convertHtml(
    '<div><img src="https://x.test/a.png"><img src="https://x.test/b.png"><img src="data:image/png;base64,AAAA"></div>',
  );
  assert.equal(res.imageJobs.length, 2);
  const out = await resolveImportedImages(res, async (src) =>
    src.includes("a.png") ? "data:image/png;base64,OK" : null,
  );
  assert.deepEqual(out, { applied: 1, failed: 1 });
  const imgs = res.all.filter((n) => n.type === "image");
  assert.equal(imgs.find((n) => n.src === "data:image/png;base64,OK") !== undefined, true);
  const failed = imgs.filter((n) => n.src === null);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].fills.length > 0); // neutral placeholder fill
  assert.ok(imgs.some((n) => n.src === "data:image/png;base64,AAAA"));
});

test("fixture: Md's real snapshot payload converts to the plan's counts", () => {
  const path = fileURLToPath(new URL("../../user/files/clipboard_data.txt", import.meta.url));
  if (!existsSync(path)) {
    console.log("skip - fixture file clipboard_data.txt not found in ../../user/files/");
    return;
  }
  const raw = readFileSync(path, "utf8");
  // The plan's "697 elements in" counts every element in the clipboard
  // file, wrappers (<html>, <body>, <x-paper-html>) included.
  assert.equal((raw.match(/<[a-zA-Z][a-zA-Z0-9-]*/g) || []).length, 697);
  const cls = classifyClipboard({ html: raw });
  assert.equal(cls.kind, "html");
  assert.equal(cls.source, "snapshot");

  const plain = parseHtmlFragment(cls.html);
  const elements = flattenElements(plain);
  assert.equal(elements.length, 694); // inner content, wrappers excluded
  let textRuns = 0;
  let flexRaw = 0;
  const countRuns = (n) => {
    if (typeof n.text === "string") {
      if (n.text.trim()) textRuns += 1;
      return;
    }
    const st = parseStyle(n.attrs.style || "");
    if (st.display === "flex") flexRaw += 1;
    for (const c of n.children || []) countRuns(c);
  };
  for (const r of plain) countRuns(r);
  assert.equal(textRuns, 185); // the plan's "185 text runs"
  assert.equal(flexRaw, 149); // the plan's "149 flex" (display:flex only)

  const res = convertHtml(cls.html);
  assert.equal(res.roots.length, 1);
  const root = res.roots[0];
  assert.equal(root.type, "frame");
  assert.equal(root.w, 1905);
  assert.equal(root.h, 4761);
  assert.equal(res.stats.images, 12); // 11 remote + the <canvas> base64 PNG
  assert.equal(res.imageJobs.length, 11); // remote only — data: needs no fetch
  assert.equal(res.stats.svgs, 45);
  assert.equal(res.stats.videos, 4); // empty shells → flagged placeholders
  assert.equal(res.stats.grids, 6); // grids flatten (no Grid in the model)
  // Runs merge into single text nodes on collapse (this model has no
  // styled runs): 185 runs − 25 merged boundaries = 160 text nodes.
  assert.equal(res.stats.texts, 160);
  // Inline flex elements inside collapsed text subtrees are absorbed
  // into the text run (as in the reference pipeline): 154 raw
  // flex/inline-flex − 23 absorbed = 131 flex frames.
  assert.equal(res.stats.flex, 131);
  assert.ok(res.all.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  for (const n of res.all) {
    for (const cid of n.childIds) {
      assert.equal(res.byId.get(cid)?.parentId, n.id);
    }
  }
});

test("new fidelity fixes: image fit, italic, flex tables, exactLayout", () => {
  assert.equal(mapObjectFit("contain"), "contain");
  assert.equal(mapObjectFit("scale-down"), "contain");
  assert.equal(mapObjectFit("cover"), "cover");
  assert.equal(mapObjectFit("none"), "fill");
  assert.equal(mapObjectFit("fill"), "fill");

  const html = `
    <div style="display:flex; justify-content:space-evenly; align-items:baseline;">
      <span style="font-style:italic;">Italic text</span>
      <img src="https://example.com/logo.png" style="object-fit:contain; width:50px; height:50px;">
    </div>
  `;
  const res = convertHtml(html);
  for (const n of res.all) formatNodeForCanvasTool(n);

  const root = res.roots[0];
  assert.equal(root.flex.alignMain, "space-evenly");
  assert.equal(root.flex.alignCross, "baseline");

  const textNode = res.all.find((n) => n.type === "text");
  assert.ok(textNode);
  assert.equal(textNode.text.italic, true);
  assert.equal(textNode.text.fontStyle, "Italic");

  const imgNode = res.all.find((n) => n.type === "image");
  assert.ok(imgNode);
  assert.equal(imgNode.image.fit, "contain");
});

for (const run of checks) await run();
console.log(`${passed} snapshot-import checks passed`);
