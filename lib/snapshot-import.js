// lib/snapshot-import.js — Snapshot / HTML paste importer (pure core).
//
// Converts clipboard HTML — most importantly the `<x-paper-html>` payload
// produced by website-snapshot tools (full computed styles inlined on
// every element, no classes/ids/scripts) — into canvas-tool nodes.
//
// Behaviour follows the verified pipeline description in
// ~/workspace/paper-design-spec/SNAPSHOT-PASTE-FULL-SOURCE-CHECK-2026-11-08.md
// and the mapping plan in IMPORTER-PLAN-2026-11-07.md, re-implemented
// from scratch against THIS app's node model (lib/model.js):
//
//   classifier → string pre-pass → DOM parse → document fix-ups →
//   tree walk (Frame / Text / Rectangle / image / svg / placeholders) →
//   style conversion → positioning pass → post-passes (flex gap
//   recovery, z-index → sibling order).
//
// The module is DOM-free by design: HTML is first reduced to a plain
// element tree ({ tag, attrs, children } / { text }), so every
// conversion decision is unit-testable in Node (scripts/
// snapshot-import-test.mjs). In the browser the plain tree comes from
// DOMParser; in Node a small built-in fallback parser produces the
// identical shape. Image fetching is NOT done here — conversion
// returns image jobs and `resolveImportedImages` applies an injected
// resolver, which keeps the failure-grouping logic testable too.
//
// Known model adaptations (see README "Snapshot / HTML paste import"):
//   - This app's nodes carry absolute x/y, so in-flow block/grid
//     children get positions from a small layout pass (the reference
//     renderer's CSS model doesn't need one). Flex children are laid
//     out by the real flex engine (lib/flex.js) as usual.
//   - Text nodes carry ONE style in this model, so an all-text subtree
//     collapses to a single text node in the subtree root's style;
//     per-run styling is lost (the text itself is not).
import { createNode, createPaint, defaultFlex } from "./model.js";
import { parseOklch, oklchToHex } from "./color.js";
import { estimateMeasureText } from "./flex.js";
import { extractFontFamiliesFromHtml, ensureFonts, DEFAULT_POPULAR_FONTS } from "./google-fonts.js";

// ---------------------------------------------------------------------------
// Clipboard classification (shared by paste + drop; order matters)
// ---------------------------------------------------------------------------

export function looksLikeSvg(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (/^<svg[\s>]/.test(t)) return true;
  // An XML prolog followed by an <svg root.
  return /^<\?xml[\s\S]*?<svg[\s>]/.test(t);
}

export function looksLikeHtml(text) {
  if (typeof text !== "string") return false;
  return /^\s*<(?:!doctype\s+html|html|body|div|span|p|a|ul|ol|li|table|section|article|header|footer|main|nav|h[1-6]|img|svg|button|form|input|figure|blockquote|pre|code)[\s/>]/i.test(text);
}

/** Inner markup of the first <x-paper-html>…</x-paper-html>, or null. */
export function extractPaperHtml(html) {
  if (typeof html !== "string") return null;
  const match = /<x-paper-html\b[^>]*>([\s\S]*?)(?:<\/x-paper-html>|$)/i.exec(html);
  if (match) return match[1].trim();
  const fragMatch = /<!--StartFragment-->([\s\S]*?)(?:<!--EndFragment-->|$)/i.exec(html);
  if (fragMatch) {
    const inner = fragMatch[1].trim();
    const paperMatch = /<x-paper-html\b[^>]*>([\s\S]*?)(?:<\/x-paper-html>|$)/i.exec(inner);
    if (paperMatch) return paperMatch[1].trim();
    return inner;
  }
  return null;
}

/**
 * Classify clipboard content { html, text, files } into a route.
 * files: array of { type } (File/Blob-like). Order (per the verified
 * source check): SVG-looking plain text → image files → x-paper-html →
 * HTML-looking plain text → any other HTML (body content) → plain text.
 */
export function classifyClipboard({ html = "", text = "", files = [] } = {}) {
  if (looksLikeSvg(text)) return { kind: "svg", text };
  const imageFiles = (files || []).filter(
    (f) => f && typeof f.type === "string" && f.type.startsWith("image/"),
  );
  if (imageFiles.length) return { kind: "files", files: imageFiles };
  const paper = extractPaperHtml(html);
  if (paper !== null) return { kind: "html", html: paper, source: "snapshot" };
  if (looksLikeHtml(text)) return { kind: "html", html: text, source: "text" };
  if (typeof html === "string" && html.trim()) return { kind: "html", html, source: "html" };
  if (typeof text === "string" && text.trim()) return { kind: "text", text };
  return { kind: "none" };
}

// "Pasting" spinner thresholds (verified behaviour): ≥100k HTML chars
// or ≥500 converted nodes.
export const BIG_PASTE_HTML_CHARS = 100000;
export const BIG_PASTE_NODES = 500;
export function isBigPaste({ htmlLength = 0, nodeCount = 0 } = {}) {
  return htmlLength >= BIG_PASTE_HTML_CHARS || nodeCount >= BIG_PASTE_NODES;
}

// ---------------------------------------------------------------------------
// Inline style parsing — a declaration tokenizer that respects quotes
// and parentheses (values contain rgb(...), url("..."), font stacks).
// ---------------------------------------------------------------------------

export function splitTopLevel(str, sep = ",") {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === quote && str[i - 1] !== "\\") quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "(") {
      depth += 1;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseStyleAttribute(styleStr) {
  const out = {};
  if (!styleStr || typeof styleStr !== "string") return out;
  for (const decl of splitTopLevel(styleStr, ";")) {
    // Split on the first ':' at paren depth 0 outside quotes.
    let depth = 0;
    let quote = null;
    let idx = -1;
    for (let i = 0; i < decl.length; i += 1) {
      const ch = decl[i];
      if (quote) {
        if (ch === quote && decl[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === ":" && depth === 0) {
        idx = i;
        break;
      }
    }
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim().replace(/\s*!important\s*$/i, "");
    if (prop) out[prop] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/**
 * Parse any CSS unit into px: px, rem, em, pt, vw, vh, and var(--name, fallback).
 * Returns number or null.
 */
export function parseUnitPx(value, base = 16) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let v = value.trim();
  if (!v) return null;

  // Resolve CSS var(--name, fallback)
  if (v.startsWith("var(") && v.endsWith(")")) {
    const inner = v.slice(4, -1).trim();
    const commaIdx = inner.indexOf(",");
    if (commaIdx >= 0) {
      v = inner.slice(commaIdx + 1).trim();
    }
  }

  const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(px|rem|em|pt|vw|vh|%)?$/i.exec(v);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || "").toLowerCase();

  switch (unit) {
    case "rem":
    case "em":
      return Math.round(num * base * 100) / 100;
    case "pt":
      return Math.round(num * 1.333333 * 100) / 100;
    case "vw":
      return Math.round(num * 14.4 * 100) / 100; // 1440px desktop base
    case "vh":
      return Math.round(num * 9.0 * 100) / 100;  // 900px desktop base
    case "%":
      return null; // Percentages handled by percent()
    case "px":
    case "":
    default:
      return num;
  }
}

/** '123px' / '2rem' / '14pt' / '50vw' / '-4.5px' / '12' → number; anything else → null. */
export function px(value) {
  return parseUnitPx(value);
}

/** '50%' → 50; anything else → null. */
export function percent(value) {
  if (typeof value !== "string") return null;
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec(value.trim());
  return m ? parseFloat(m[1]) : null;
}

const NAMED_COLORS = {
  black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#008000",
  blue: "#0000FF", yellow: "#FFFF00", gray: "#808080", grey: "#808080",
  silver: "#C0C0C0", maroon: "#800000", purple: "#800080", fuchsia: "#FF00FF",
  lime: "#00FF00", olive: "#808000", navy: "#000080", teal: "#008080",
  aqua: "#00FFFF", orange: "#FFA500",
};

/**
 * Parse a CSS colour into { hex: '#RRGGBB', opacity: 0..100 } or null.
 * Handles #hex, rgb()/rgba() (comma and space forms), oklch()/oklab(),
 * a small named set, and 'transparent'.
 */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v === "transparent") return { hex: "#000000", opacity: 0 };
  if (NAMED_COLORS[v]) return { hex: NAMED_COLORS[v], opacity: 100 };
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) return { hex: `#${h.toUpperCase()}`, opacity: 100 };
    if (h.length === 8) {
      const a = parseInt(h.slice(6, 8), 16) / 255;
      return { hex: `#${h.slice(0, 6).toUpperCase()}`, opacity: Math.round(a * 100) };
    }
    return null;
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (s) => {
      if (s.endsWith("%")) return Math.round((parseFloat(s) / 100) * 255);
      return Math.round(parseFloat(s));
    };
    const [r, g, b] = parts.slice(0, 3).map(chan);
    if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
    let opacity = 100;
    if (parts.length > 3) {
      const a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      if (Number.isFinite(a)) opacity = Math.round(Math.min(1, Math.max(0, a)) * 100);
    }
    const hex = `#${[r, g, b].map((n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    return { hex, opacity };
  }
  if (v.startsWith("oklch(")) {
    const parsed = parseOklch(v);
    if (!parsed) return null;
    return { hex: oklchToHex(parsed), opacity: 100 };
  }
  if (v.startsWith("oklab(")) {
    // oklab(L a b[/ alpha]) → oklch via polar conversion.
    const inner = v.slice(6, -1).replace(/\//g, " ").split(/\s+/).filter(Boolean);
    if (inner.length < 3) return null;
    const L = parseFloat(inner[0]);
    const a = parseFloat(inner[1]);
    const b = parseFloat(inner[2]);
    if (![L, a, b].every(Number.isFinite)) return null;
    const c = Math.hypot(a, b);
    let h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    let opacity = 100;
    if (inner.length > 3) {
      const al = inner[3].endsWith("%") ? parseFloat(inner[3]) / 100 : parseFloat(inner[3]);
      if (Number.isFinite(al)) opacity = Math.round(Math.min(1, Math.max(0, al)) * 100);
    }
    return { hex: oklchToHex({ l: L, c, h }), opacity };
  }
  return null;
}

/** margin/padding shorthand + longhands (including block/inline logical props) → { top, right, bottom, left, auto: {..} } in px (null = unset). */
export function parseBoxEdges(style, base) {
  const edges = { top: null, right: null, bottom: null, left: null, auto: { top: false, right: false, bottom: false, left: false } };
  const read = (side) => {
    const v = style[`${base}-${side}`];
    if (typeof v !== "string") return;
    if (v.trim() === "auto") {
      edges.auto[side] = true;
      edges[side] = null;
    } else {
      edges[side] = px(v);
    }
  };
  if (typeof style[base] === "string") {
    const parts = style[base].trim().split(/\s+/);
    const vals = parts.map((p) => (p === "auto" ? "auto" : px(p)));
    const [a, b, c, d] = vals;
    const t = a, r = b ?? a, bo = c ?? a, l = d ?? b ?? a;
    const raw = [t, r, bo, l];
    const autoRaw = [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]];
    ["top", "right", "bottom", "left"].forEach((side, i) => {
      edges[side] = typeof raw[i] === "number" ? raw[i] : null;
      edges.auto[side] = autoRaw[i] === "auto";
    });
  }
  // Logical block/inline shorthands
  if (typeof style[`${base}-block`] === "string") {
    if (style[`${base}-block`].trim() === "auto") {
      edges.auto.top = true;
      edges.auto.bottom = true;
    } else {
      const p = px(style[`${base}-block`]);
      if (p !== null) { edges.top = p; edges.bottom = p; }
    }
  }
  if (typeof style[`${base}-inline`] === "string") {
    if (style[`${base}-inline`].trim() === "auto") {
      edges.auto.left = true;
      edges.auto.right = true;
    } else {
      const p = px(style[`${base}-inline`]);
      if (p !== null) { edges.left = p; edges.right = p; }
    }
  }
  // Logical longhands
  if (typeof style[`${base}-block-start`] === "string") {
    if (style[`${base}-block-start`].trim() === "auto") edges.auto.top = true;
    else edges.top = px(style[`${base}-block-start`]);
  }
  if (typeof style[`${base}-block-end`] === "string") {
    if (style[`${base}-block-end`].trim() === "auto") edges.auto.bottom = true;
    else edges.bottom = px(style[`${base}-block-end`]);
  }
  if (typeof style[`${base}-inline-start`] === "string") {
    if (style[`${base}-inline-start`].trim() === "auto") edges.auto.left = true;
    else edges.left = px(style[`${base}-inline-start`]);
  }
  if (typeof style[`${base}-inline-end`] === "string") {
    if (style[`${base}-inline-end`].trim() === "auto") edges.auto.right = true;
    else edges.right = px(style[`${base}-inline-end`]);
  }

  for (const side of ["top", "right", "bottom", "left"]) read(side);
  return edges;
}

// ---------------------------------------------------------------------------
// HTML → plain element tree
// Plain element: { tag, attrs: {name: value}, children: [el | { text }] }
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);

export function decodeEntities(s) {
  if (!s || !s.includes("&")) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, "\u00A0")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Minimal fallback HTML fragment parser (Node tests; DOM-free path). */
export function parseFragmentFallback(html) {
  const roots = [];
  const stack = [{ tag: "#root", children: roots }];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = html.length;
  const pushText = (raw) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && typeof last.text === "string") last.text += text;
    else kids.push({ text });
  };
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = findTagEnd(html, lt);
    if (gt < 0) {
      pushText(html.slice(lt));
      break;
    }
    const rawTag = html.slice(lt + 1, gt);
    i = gt + 1;
    if (rawTag.startsWith("/")) {
      const name = rawTag.slice(1).trim().toLowerCase();
      // Pop to the matching open tag (mismatched closes are ignored).
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tag === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }
    const selfClosing = /\/\s*$/.test(rawTag);
    const body = selfClosing ? rawTag.replace(/\/\s*$/, "") : rawTag;
    const m = /^([a-zA-Z][^\s/>]*)/.exec(body);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const el = { tag, attrs: parseAttributes(body.slice(m[0].length)), children: [] };
    top().children.push(el);
    if (selfClosing || VOID_TAGS.has(tag)) continue;
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      const raw = close < 0 ? html.slice(i) : html.slice(i, close);
      if (raw) el.children.push({ text: raw });
      if (close < 0) {
        i = n;
      } else {
        const cgt = html.indexOf(">", close);
        i = cgt < 0 ? n : cgt + 1;
      }
      continue;
    }
    stack.push(el);
  }
  return unwrapRoots(roots);
}

function findTagEnd(html, lt) {
  let quote = null;
  for (let i = lt + 1; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

function parseAttributes(str) {
  const attrs = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** DOM (browser) → plain tree conversion. */
function domToPlain(node) {
  if (node.nodeType === 3) return { text: node.textContent || "" };
  if (node.nodeType !== 1) return null;
  const el = { tag: node.tagName.toLowerCase(), attrs: {}, children: [] };
  for (const attr of node.attributes || []) el.attrs[attr.name.toLowerCase()] = attr.value;
  for (const child of node.childNodes || []) {
    const p = domToPlain(child);
    if (p) el.children.push(p);
  }
  return el;
}

function unwrapRoots(roots) {
  // Full documents: descend through <html> / <body> / <x-paper-html> / <x-snap> wrappers.
  let list = roots;
  for (let depth = 0; depth < 5; depth += 1) {
    const el = list.find((r) => r && (r.tag === "html" || r.tag === "body" || r.tag === "x-paper-html" || r.tag === "x-snap"));
    if (!el) break;
    list = (el.children || []).filter((c) => c && (typeof c.text !== "string" || c.text.trim().length > 0));
  }
  return list;
}

/**
 * Parse an HTML string (fragment or full document) into plain-tree
 * roots. Uses DOMParser when available (browser), else the fallback.
 */
export function parseHtmlFragment(html) {
  const str = typeof html === "string" ? html : "";
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(str, "text/html");
    const roots = [];
    for (const child of doc.body ? doc.body.childNodes : []) {
      const p = domToPlain(child);
      if (p) roots.push(p);
    }
    return unwrapRoots(roots);
  }
  return unwrapRoots(parseFragmentFallback(str));
}

/** Serialize a plain tree back to markup (for inline <svg> nodes). */
export function serializePlain(node) {
  if (typeof node.text === "string") {
    return node.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const attrs = Object.entries(node.attrs || {})
    .map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
  const kids = (node.children || []).map(serializePlain).join("");
  if (!kids && VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${kids}</${node.tag}>`;
}

/** Count every element in a plain tree (text leaves excluded). */
export function countElements(roots) {
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node.text === "string") return;
    n += 1;
    for (const c of node.children || []) walk(c);
  };
  for (const r of roots || []) walk(r);
  return n;
}

/** Every element of a plain tree in preorder (document order). */
export function flattenElements(roots) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node.text === "string") return;
    out.push(node);
    for (const c of node.children || []) walk(c);
  };
  for (const r of roots || []) walk(r);
  return out;
}

// Dimensions declared by an <svg> string (viewBox / width / height).
export function svgDimensions(svgMarkup) {
  const out = { w: null, h: null, viewBox: null };
  if (typeof svgMarkup !== "string") return out;
  const gtIdx = svgMarkup.indexOf(">");
  const head = gtIdx !== -1 ? svgMarkup.slice(0, gtIdx + 1) : svgMarkup.slice(0, 1024);
  const vb = /viewbox\s*=\s*["']?([^"'>]+)["']?/i.exec(head);
  if (vb) {
    out.viewBox = vb[1].trim();
    const parts = out.viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      out.w = parts[2];
      out.h = parts[3];
    }
  }
  const w = /\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/i.exec(head);
  const h = /\bheight\s*=\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/i.exec(head);
  if (w) out.w = parseFloat(w[1]);
  if (h) out.h = parseFloat(h[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Document fix-ups (plain tree, before the walk) — verified Stage B
// ---------------------------------------------------------------------------

const TEXT_INPUT_TYPES = new Set([
  "", "text", "search", "tel", "url", "email", "password", "number",
  "date", "datetime-local", "month", "week", "time", "submit", "reset", "button",
]);

function elementText(el) {
  let out = "";
  const walk = (n) => {
    if (typeof n.text === "string") {
      out += n.text;
      return;
    }
    for (const c of n.children || []) walk(c);
  };
  walk(el);
  return out;
}

function eachElement(roots, fn) {
  const walk = (n) => {
    if (!n || typeof n.text === "string") return;
    fn(n);
    for (const c of n.children || []) walk(c);
  };
  for (const r of roots || []) walk(r);
}

/** Form controls → a single text child (value, else placeholder). */
function fixFormControl(el) {
  if (el.tag === "input") {
    const type = (el.attrs.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio" || !TEXT_INPUT_TYPES.has(type)) return;
    const value = el.attrs.value || "";
    const placeholder = el.attrs.placeholder || "";
    const text = value || placeholder;
    el.children = text ? [{ text }] : [];
    if (!value && placeholder) el.__placeholder = true;
    return;
  }
  if (el.tag === "textarea") {
    const value = elementText(el);
    const placeholder = el.attrs.placeholder || "";
    const text = value || placeholder;
    el.children = text ? [{ text }] : [];
    if (!value && placeholder) el.__placeholder = true;
    return;
  }
  if (el.tag === "select") {
    const options = (el.children || []).filter((c) => c.tag === "option");
    const chosen = options.find((o) => "selected" in (o.attrs || {})) || options[0];
    const text = chosen ? elementText(chosen).trim() : "";
    el.children = text ? [{ text }] : [];
  }
}

const LOGICAL_BORDER_WIDTH = {
  top: "border-block-start-width",
  bottom: "border-block-end-width",
  left: "border-inline-start-width",
  right: "border-inline-end-width",
};
const LOGICAL_BORDER_STYLE = {
  top: "border-block-start-style",
  bottom: "border-block-end-style",
  left: "border-inline-start-style",
  right: "border-inline-end-style",
};
const LOGICAL_BORDER_COLOR = {
  top: "border-block-start-color",
  bottom: "border-block-end-color",
  left: "border-inline-start-color",
  right: "border-inline-end-color",
};
const LOGICAL_BORDER_SHORTHAND = {
  top: "border-block-start",
  bottom: "border-block-end",
  left: "border-inline-start",
  right: "border-inline-end",
};

function borderWidthPx(style, side) {
  const logicalKey = side ? LOGICAL_BORDER_WIDTH[side] : null;
  const direct = px(style[`border-${side}-width`] ?? (logicalKey ? style[logicalKey] : null));
  if (direct !== null) return direct;
  const all = px(style["border-width"] ?? style["border-block-width"] ?? style["border-inline-width"]);
  if (all !== null) return all;
  const logicalShort = side ? LOGICAL_BORDER_SHORTHAND[side] : null;
  const shorthand = style.border || (side ? (style[`border-${side}`] || (logicalShort ? style[logicalShort] : null)) : null);
  if (typeof shorthand === "string") {
    const m = /(\d+(?:\.\d+)?)px/.exec(shorthand);
    if (m) return parseFloat(m[1]);
    if (/\b(?:thin)\b/.test(shorthand)) return 1;
    if (/\b(?:medium)\b/.test(shorthand)) return 3;
    if (/\b(?:thick)\b/.test(shorthand)) return 5;
  }
  return 0;
}

/** box-sizing: content-box → widen px sizes by padding + border. */
function fixContentBox(el, style) {
  if ((style["box-sizing"] || "") !== "content-box") return;
  const pad = parseBoxEdges(style, "padding");
  const addX = (pad.left || 0) + (pad.right || 0) + borderWidthPx(style, "left") + borderWidthPx(style, "right");
  const addY = (pad.top || 0) + (pad.bottom || 0) + borderWidthPx(style, "top") + borderWidthPx(style, "bottom");
  for (const prop of ["width", "min-width", "max-width"]) {
    const v = px(style[prop]);
    if (v !== null && addX) style[prop] = `${v + addX}px`;
  }
  for (const prop of ["height", "min-height", "max-height"]) {
    const v = px(style[prop]);
    if (v !== null && addY) style[prop] = `${v + addY}px`;
  }
}

/** Absolute/fixed normalisation: logical insets → physical; auto-margin centring → flags. */
function fixAbsolute(el, style) {
  const pos = style.position;
  if (pos !== "absolute" && pos !== "fixed") return;
  if (style.top === undefined && style["inset-block-start"] !== undefined) style.top = style["inset-block-start"];
  if (style.bottom === undefined && style["inset-block-end"] !== undefined) style.bottom = style["inset-block-end"];
  if (style.left === undefined && style["inset-inline-start"] !== undefined) style.left = style["inset-inline-start"];
  if (style.right === undefined && style["inset-inline-end"] !== undefined) style.right = style["inset-inline-end"];
  if (typeof style.inset === "string") {
    const parts = style.inset.trim().split(/\s+/);
    const [t, r, b, l] = [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]];
    if (style.top === undefined) style.top = t;
    if (style.right === undefined) style.right = r;
    if (style.bottom === undefined) style.bottom = b;
    if (style.left === undefined) style.left = l;
  }
  const margins = parseBoxEdges(style, "margin");
  const has = (k) => typeof style[k] === "string" && style[k] !== "auto" && style[k] !== "";
  if (has("left") && has("right") && px(style.width) !== null && margins.auto.left && margins.auto.right) {
    el.__centerX = true;
  }
  if (has("top") && has("bottom") && px(style.height) !== null && margins.auto.top && margins.auto.bottom) {
    el.__centerY = true;
  }
}

// ---------------------------------------------------------------------------
// Utility class resolver (Tailwind / utility CSS fallback)
// ---------------------------------------------------------------------------

const TAILWIND_COLORS = {
  white: "#ffffff",
  black: "#000000",
  transparent: "transparent",
  current: "currentColor",
  inherit: "inherit",
  // Theme semantic variables
  card: "#ffffff",
  "card-foreground": "#09090b",
  background: "#ffffff",
  foreground: "#09090b",
  muted: "#f4f4f5",
  "muted-foreground": "#71717a",
  border: "#e4e4e7",
  input: "#e4e4e7",
  ring: "#09090b",
  primary: "#09090b",
  "primary-foreground": "#fafafa",
  secondary: "#f4f4f5",
  "secondary-foreground": "#18181b",
  accent: "#f4f4f5",
  "accent-foreground": "#18181b",
  destructive: "#ef4444",
  "destructive-foreground": "#fafafa",
  popover: "#ffffff",
  "popover-foreground": "#09090b",
  // Emerald
  "emerald-50": "#ecfdf5", "emerald-100": "#d1fae5", "emerald-200": "#a7f3d0", "emerald-300": "#6ee7b7",
  "emerald-400": "#34d399", "emerald-500": "#10b981", "emerald-600": "#059669", "emerald-700": "#047857",
  "emerald-800": "#065f46", "emerald-900": "#064e3b", "emerald-950": "#022c22",
  // Zinc
  "zinc-50": "#fafafa", "zinc-100": "#f4f4f5", "zinc-200": "#e4e4e7", "zinc-300": "#d4d4d8",
  "zinc-400": "#a1a1aa", "zinc-500": "#71717a", "zinc-600": "#52525b", "zinc-700": "#3f3f46",
  "zinc-800": "#27272a", "zinc-900": "#18181b", "zinc-950": "#09090b",
  // Gray
  "gray-50": "#f9fafb", "gray-100": "#f3f4f6", "gray-200": "#e5e7eb", "gray-300": "#d1d5db",
  "gray-400": "#9ca3af", "gray-500": "#6b7280", "gray-600": "#4b5563", "gray-700": "#374151",
  "gray-800": "#1f2937", "gray-900": "#111827", "gray-950": "#030712",
  // Slate
  "slate-50": "#f8fafc", "slate-100": "#f1f5f9", "slate-200": "#e2e8f0", "slate-300": "#cbd5e1",
  "slate-400": "#94a3b8", "slate-500": "#64748b", "slate-600": "#475569", "slate-700": "#334155",
  "slate-800": "#1e293b", "slate-900": "#0f172a", "slate-950": "#020617",
  // Neutral
  "neutral-50": "#fafafa", "neutral-100": "#f5f5f5", "neutral-200": "#e5e5e5", "neutral-300": "#d4d4d4",
  "neutral-400": "#a3a3a3", "neutral-500": "#737373", "neutral-600": "#525252", "neutral-700": "#404040",
  "neutral-800": "#262626", "neutral-900": "#171717", "neutral-950": "#0a0a0a",
  // Blue
  "blue-50": "#eff6ff", "blue-100": "#dbeafe", "blue-200": "#bfdbfe", "blue-300": "#93c5fd",
  "blue-400": "#60a5fa", "blue-500": "#3b82f6", "blue-600": "#2563eb", "blue-700": "#1d4ed8",
  "blue-800": "#1e40af", "blue-900": "#1e3a8a", "blue-950": "#172554",
  // Red
  "red-50": "#fef2f2", "red-100": "#fee2e2", "red-200": "#fecaca", "red-300": "#fca5a5",
  "red-400": "#f87171", "red-500": "#ef4444", "red-600": "#dc2626", "red-700": "#b91c1c",
  "red-800": "#991b1b", "red-900": "#7f1d1d", "red-950": "#450a0a",
  // Amber / Orange / Green / Violet / Purple / Cyan
  "amber-500": "#f59e0b", "orange-500": "#f97316", "green-500": "#22c55e",
  "violet-500": "#8b5cf6", "purple-500": "#a855f7", "cyan-500": "#06b6d4",
};

const SPACING_MAP = {
  "0": "0px", "0.5": "2px", "1": "4px", "1.5": "6px", "2": "8px", "2.5": "10px",
  "3": "12px", "3.5": "14px", "4": "16px", "5": "20px", "6": "24px", "7": "28px",
  "8": "32px", "9": "36px", "10": "40px", "11": "44px", "12": "48px", "14": "56px",
  "16": "64px", "20": "80px", "24": "96px", "28": "112px", "32": "128px",
};

const RADIUS_MAP = {
  none: "0px", sm: "2px", DEFAULT: "4px", md: "6px", lg: "8px",
  xl: "12px", "2xl": "16px", "3xl": "24px", full: "9999px",
};

const MAX_WIDTH_MAP = {
  xs: "320px", sm: "384px", md: "448px", lg: "512px", xl: "576px",
  "2xl": "672px", "3xl": "768px", "4xl": "896px", "5xl": "1024px",
  "6xl": "1152px", "7xl": "1280px", full: "100%", min: "min-content",
  max: "max-content", fit: "fit-content",
};

export function resolveUtilityClasses(classStr) {
  if (!classStr || typeof classStr !== "string") return {};
  const classes = classStr.trim().split(/\s+/);
  const s = {};

  for (const cls of classes) {
    if (!cls || cls.includes(":")) continue;

    // Display
    if (cls === "flex") s.display = "flex";
    else if (cls === "inline-flex") s.display = "inline-flex";
    else if (cls === "block") s.display = "block";
    else if (cls === "inline-block") s.display = "inline-block";
    else if (cls === "grid") s.display = "grid";
    else if (cls === "inline-grid") s.display = "inline-grid";
    else if (cls === "hidden") s.display = "none";

    // Flex layout
    else if (cls === "flex-col") s["flex-direction"] = "column";
    else if (cls === "flex-row") s["flex-direction"] = "row";
    else if (cls === "flex-wrap") s["flex-wrap"] = "wrap";
    else if (cls === "flex-nowrap") s["flex-wrap"] = "nowrap";
    else if (cls === "items-center") s["align-items"] = "center";
    else if (cls === "items-start") s["align-items"] = "flex-start";
    else if (cls === "items-end") s["align-items"] = "flex-end";
    else if (cls === "items-stretch") s["align-items"] = "stretch";
    else if (cls === "items-baseline") s["align-items"] = "baseline";
    else if (cls === "justify-center") s["justify-content"] = "center";
    else if (cls === "justify-between") s["justify-content"] = "space-between";
    else if (cls === "justify-start") s["justify-content"] = "flex-start";
    else if (cls === "justify-end") s["justify-content"] = "flex-end";
    else if (cls === "justify-around") s["justify-content"] = "space-around";
    else if (cls === "flex-1") s.flex = "1 1 0%";
    else if (cls === "flex-auto") s.flex = "1 1 auto";
    else if (cls === "flex-initial") s.flex = "0 1 auto";
    else if (cls === "flex-none") s.flex = "none";
    else if (cls === "shrink-0" || cls === "flex-shrink-0") s["flex-shrink"] = "0";
    else if (cls === "grow" || cls === "flex-grow") s["flex-grow"] = "1";

    // Width & Height
    else if (cls === "w-full") s.width = "100%";
    else if (cls === "w-screen") s.width = "100vw";
    else if (cls === "w-fit") s.width = "fit-content";
    else if (cls === "w-auto") s.width = "auto";
    else if (cls === "h-full") s.height = "100%";
    else if (cls === "h-screen") s.height = "100vh";
    else if (cls === "h-fit") s.height = "fit-content";
    else if (cls === "h-auto") s.height = "auto";
    else if (cls.startsWith("max-w-[")) {
      const m = cls.match(/^max-w-\[([^\]]+)\]$/);
      if (m) s["max-width"] = m[1];
    } else if (cls.startsWith("max-w-")) {
      const k = cls.slice(6);
      if (MAX_WIDTH_MAP[k]) s["max-width"] = MAX_WIDTH_MAP[k];
    } else if (cls.startsWith("w-[")) {
      const m = cls.match(/^w-\[([^\]]+)\]$/);
      if (m) s.width = m[1];
    } else if (cls.startsWith("h-[")) {
      const m = cls.match(/^h-\[([^\]]+)\]$/);
      if (m) s.height = m[1];
    } else if (cls === "min-w-0") s["min-width"] = "0px";

    // Margins (auto centering)
    else if (cls === "mx-auto") {
      s["margin-left"] = "auto";
      s["margin-right"] = "auto";
    }

    // Borders
    else if (cls === "border") {
      s["border-width"] = "1px";
      s["border-style"] = "solid";
    } else if (cls === "border-0") {
      s["border-width"] = "0px";
    } else if (cls.startsWith("border-") && /^\d+$/.test(cls.slice(7))) {
      s["border-width"] = `${cls.slice(7)}px`;
      s["border-style"] = "solid";
    } else if (cls.startsWith("border-[")) {
      const m = cls.match(/^border-\[([^\]]+)\]$/);
      if (m) {
        if (m[1].endsWith("px") || /^\d+$/.test(m[1])) {
          s["border-width"] = m[1].endsWith("px") ? m[1] : `${m[1]}px`;
          s["border-style"] = "solid";
        } else {
          s["border-color"] = m[1];
          if (!s["border-width"]) s["border-width"] = "1px";
          s["border-style"] = "solid";
        }
      }
    } else if (cls.startsWith("border-")) {
      const colorKey = cls.slice(7);
      if (TAILWIND_COLORS[colorKey]) {
        s["border-color"] = TAILWIND_COLORS[colorKey];
        if (!s["border-width"]) s["border-width"] = "1px";
        if (!s["border-style"]) s["border-style"] = "solid";
      }
    }

    // Border Radius
    else if (cls === "rounded") s["border-radius"] = RADIUS_MAP.DEFAULT;
    else if (cls.startsWith("rounded-[")) {
      const m = cls.match(/^rounded-\[([^\]]+)\]$/);
      if (m) s["border-radius"] = m[1];
    } else if (cls.startsWith("rounded-")) {
      const rKey = cls.slice(8);
      if (RADIUS_MAP[rKey]) s["border-radius"] = RADIUS_MAP[rKey];
    }

    // Backgrounds
    else if (cls.startsWith("bg-[")) {
      const m = cls.match(/^bg-\[([^\]]+)\]$/);
      if (m) s["background-color"] = m[1];
    } else if (cls.startsWith("bg-")) {
      const colorKey = cls.slice(3);
      if (TAILWIND_COLORS[colorKey]) {
        s["background-color"] = TAILWIND_COLORS[colorKey];
      }
    }

    // Text Colors & Typography
    else if (cls.startsWith("text-[")) {
      const m = cls.match(/^text-\[([^\]]+)\]$/);
      if (m) {
        if (m[1].endsWith("px") || m[1].endsWith("rem")) s["font-size"] = m[1];
        else s.color = m[1];
      }
    } else if (cls.startsWith("text-")) {
      const key = cls.slice(5);
      if (TAILWIND_COLORS[key]) {
        s.color = TAILWIND_COLORS[key];
      } else if (key === "xs") s["font-size"] = "12px";
      else if (key === "sm") s["font-size"] = "14px";
      else if (key === "base") s["font-size"] = "16px";
      else if (key === "lg") s["font-size"] = "18px";
      else if (key === "xl") s["font-size"] = "20px";
      else if (key === "2xl") s["font-size"] = "24px";
      else if (key === "3xl") s["font-size"] = "30px";
      else if (key === "4xl") s["font-size"] = "36px";
    }

    // Font Weight
    else if (cls === "font-normal") s["font-weight"] = "400";
    else if (cls === "font-medium") s["font-weight"] = "500";
    else if (cls === "font-semibold") s["font-weight"] = "600";
    else if (cls === "font-bold") s["font-weight"] = "700";

    // Padding
    else if (cls.startsWith("p-[")) {
      const m = cls.match(/^p-\[([^\]]+)\]$/);
      if (m) s.padding = m[1];
    } else if (cls.startsWith("p-")) {
      const val = cls.slice(2);
      if (SPACING_MAP[val]) s.padding = SPACING_MAP[val];
    } else if (cls.startsWith("px-")) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) {
        s["padding-left"] = SPACING_MAP[val];
        s["padding-right"] = SPACING_MAP[val];
      }
    } else if (cls.startsWith("py-")) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) {
        s["padding-top"] = SPACING_MAP[val];
        s["padding-bottom"] = SPACING_MAP[val];
      }
    } else if (cls.startsWith("pt-")) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) s["padding-top"] = SPACING_MAP[val];
    } else if (cls.startsWith("pb-")) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) s["padding-bottom"] = SPACING_MAP[val];
    } else if (cls.startsWith("pl-")) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) s["padding-left"] = SPACING_MAP[val];
    } else if (cls.startsWith("pr-")) {
      const val = cls.slice(3);
      if (SPACING_MAP[val]) s["padding-right"] = SPACING_MAP[val];
    }

    // Spacing & Gaps
    else if (cls.startsWith("gap-")) {
      const val = cls.slice(4);
      if (SPACING_MAP[val]) s.gap = SPACING_MAP[val];
    } else if (cls.startsWith("space-y-")) {
      const val = cls.slice(8);
      if (SPACING_MAP[val]) s["row-gap"] = SPACING_MAP[val];
    } else if (cls.startsWith("space-x-")) {
      const val = cls.slice(8);
      if (SPACING_MAP[val]) s["column-gap"] = SPACING_MAP[val];
    }

    // Shadows
    else if (cls === "shadow-md") {
      s["box-shadow"] = "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)";
    } else if (cls === "shadow-sm") {
      s["box-shadow"] = "0 1px 2px 0 rgb(0 0 0 / 0.05)";
    } else if (cls === "shadow") {
      s["box-shadow"] = "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)";
    } else if (cls === "shadow-lg") {
      s["box-shadow"] = "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)";
    }
  }

  return s;
}

export function applyDocumentFixups(roots) {
  eachElement(roots, (el) => {
    if (el.tag === "fieldset" || el.tag === "legend") el.tag = "div";
    fixFormControl(el);
    const inlineStyle = parseStyleAttribute(el.attrs.style || "");
    const classStr = el.attrs.class || el.attrs.className || "";
    const utilityStyle = resolveUtilityClasses(classStr);
    const style = { ...utilityStyle, ...inlineStyle };
    fixContentBox(el, style);
    fixAbsolute(el, style);
    const margins = parseBoxEdges(style, "margin");
    if (margins.auto?.left && margins.auto?.right) {
      el.__centerX = true;
    }
    if (margins.auto?.top && margins.auto?.bottom) {
      el.__centerY = true;
    }
    // Write corrected declarations back so the walk reads one source.
    el.__style = style;
  });
  return roots;
}

// ---------------------------------------------------------------------------
// Style conversion helpers (CSS → this app's model shapes)
// ---------------------------------------------------------------------------

const BLEND_BY_CSS = {
  normal: "Normal", darken: "Darken", multiply: "Multiply",
  "color-burn": "Color Burn", lighten: "Lighten", screen: "Screen",
  "color-dodge": "Color Dodge", overlay: "Overlay",
  "soft-light": "Soft Light", "hard-light": "Hard Light",
  difference: "Difference", exclusion: "Exclusion", hue: "Hue",
  saturation: "Saturation", color: "Color", luminosity: "Luminosity",
  "plus-lighter": "Plus lighter",
};

export function parseGradient(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const m = /^(linear|radial)-gradient\(([\s\S]*)\)$/.exec(v);
  if (!m) return null;
  const parts = splitTopLevel(m[2]).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let angle = 180;
  let stopParts = parts;
  if (m[1] === "linear") {
    const first = parts[0].toLowerCase();
    const deg = /^(-?\d+(?:\.\d+)?)deg$/.exec(first);
    const dirs = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to bottom right": 135, "to bottom left": 225, "to top left": 315 };
    if (deg) {
      angle = parseFloat(deg[1]);
      stopParts = parts.slice(1);
    } else if (dirs[first] !== undefined) {
      angle = dirs[first];
      stopParts = parts.slice(1);
    }
  } else if (/^(circle|ellipse)\b/.test(parts[0]) || /\bat\b/.test(parts[0])) {
    stopParts = parts.slice(1); // radial shape/position prelude — geometry not modelled
  }
  const stops = [];
  for (const part of stopParts) {
    // A stop is "<color> [<pos>% or px]" — colour may itself contain parens.
    const pm = /^([\s\S]*?)(?:\s+(-?\d+(?:\.\d+)?)(?:%|px)?)?$/.exec(part);
    if (!pm) continue;
    const color = parseColor(pm[1].trim());
    if (!color) continue;
    stops.push({ color: color.hex, at: pm[2] !== undefined ? parseFloat(pm[2]) : null, tokenId: null, opacity: color.opacity });
  }
  if (stops.length < 2) return null;
  // Fill in missing stop positions evenly (CSS rules).
  stops.forEach((s, i) => {
    if (s.at === null) s.at = stops.length === 1 ? 0 : (i / (stops.length - 1)) * 100;
  });
  return {
    kind: m[1] === "radial" ? "radial" : "linear",
    angle,
    stops: stops.map(({ color, at, tokenId }) => ({ color, at, tokenId })),
    css: v,
  };
}

/** background-image value → list of { type:'image', src } | { type:'gradient', gradient }. */
export function parseBackgroundImage(value) {
  if (typeof value !== "string" || !value.trim() || value.trim() === "none") return [];
  const layers = [];
  for (const part of splitTopLevel(value)) {
    const p = part.trim();
    if (!p || p === "none") continue;
    const url = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)$/i.exec(p);
    if (url) {
      layers.push({ type: "image", src: (url[1] ?? url[2] ?? url[3] ?? "").trim() });
      continue;
    }
    const gradient = parseGradient(p);
    if (gradient) layers.push({ type: "gradient", gradient });
  }
  return layers;
}

export function parseBoxShadow(value) {
  const out = { outer: [], inner: [] };
  if (typeof value !== "string" || !value.trim() || value.trim() === "none") return out;
  for (const part of splitTopLevel(value)) {
    let s = part.trim();
    if (!s) continue;
    const inset = /\binset\b/.test(s);
    s = s.replace(/\binset\b/, "").trim();
    // Colour may appear anywhere; extract a trailing/leading colour token.
    let color = null;
    const colorMatch = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\))\s*$/.exec(s)
      || /^\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\))/.exec(s);
    if (colorMatch) {
      color = parseColor(colorMatch[1]);
      s = s.replace(colorMatch[1], "").trim();
    }
    const lens = s.split(/\s+/).map((t) => px(t)).filter((n) => n !== null);
    if (lens.length < 2) continue;
    const op = color?.opacity ?? 100;
    const alpha = op > 1 ? op / 100 : op;
    const shadow = {
      x: lens[0], y: lens[1], blur: lens[2] ?? 0, spread: lens[3] ?? 0,
      color: color?.hex || "#000000", opacity: op, alpha,
      visible: true, tokenId: null,
    };
    (inset ? out.inner : out.outer).push(shadow);
  }
  return out;
}

const BORDER_SIDES = ["top", "right", "bottom", "left"];
const SIDE_LABEL = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };

// Known UA-default border colors that come from Chrome computed styles when no real border exists.
// These appear because Chrome dumps border-style/color even when border-width is 0.
const UA_DEFAULT_BORDER_COLORS = new Set([
  "rgb(0, 0, 0)",
  "rgb(17, 24, 39)",     // Tailwind gray-900 — also used as text color; Chrome copies to border-color
]);

// When Chrome/Paper dumps computed styles, it emits border-style and border-color on EVERY element
// even if the actual border-width is 0. We detect this pattern:
//   - border-width is explicitly "0px" or "0" (or not specified at all and resolves to 0)
//   - border-style is "solid" (browser default after CSS normalization)
//   - border-color matches UA default (the currentColor inheritance from text color)
// In these cases, the border must be suppressed because there is no actual visible border.
function isBorderWidthExplicitlyZero(style, side) {
  const logicalKey = side ? LOGICAL_BORDER_WIDTH[side] : null;
  const direct = style[`border-${side}-width`] ?? (logicalKey ? style[logicalKey] : undefined);
  if (direct !== undefined) {
    const v = px(direct);
    return v !== null && v <= 0;
  }
  const all = style["border-width"] ?? style["border-block-width"] ?? style["border-inline-width"];
  if (all !== undefined) {
    const v = px(all);
    return v !== null && v <= 0;
  }
  // border shorthand explicitly set to 0
  const short = style[`border-${side}`] ?? style.border;
  if (typeof short === "string") {
    const t = short.trim().toLowerCase();
    if (t === "0" || t === "0px" || t === "none" || t === "hidden") return true;
    // If shorthand exists but has no px width, it defaults to medium (3px) — not zero
  }
  return false;
}

export function parseBorders(style) {
  const borders = [];
  for (const side of BORDER_SIDES) {
    let width = borderWidthPx(style, side);
    const logicalStyle = LOGICAL_BORDER_STYLE[side];
    const logicalColor = LOGICAL_BORDER_COLOR[side];
    const logicalShort = LOGICAL_BORDER_SHORTHAND[side];
    let bStyle = style[`border-${side}-style`] || (logicalStyle ? style[logicalStyle] : null) || style["border-style"] || style["border-block-style"] || style["border-inline-style"] || null;
    let colorStr = style[`border-${side}-color`] || (logicalColor ? style[logicalColor] : null) || style["border-color"] || style["border-block-color"] || style["border-inline-color"] || null;
    const shorthand = style[`border-${side}`] || (logicalShort ? style[logicalShort] : null) || style.border;
    if (typeof shorthand === "string") {
      const sTrim = shorthand.trim().toLowerCase();
      if (sTrim === "none" || sTrim === "0" || sTrim === "0px" || sTrim === "hidden") {
        continue;
      }
      if (width === 0) width = borderWidthPx({ border: shorthand }, side);
      if (!bStyle) {
        const sm = /\b(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)\b/.exec(shorthand);
        if (sm) bStyle = sm[1];
      }
      if (!colorStr) {
        if (/\btransparent\b/i.test(shorthand)) {
          colorStr = "transparent";
        } else if (/\bcurrentColor\b/i.test(shorthand)) {
          colorStr = style.color || "currentColor";
        } else {
          const cm = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|\b(?:black|white|gray|grey|red|blue|green|yellow|purple|pink|orange|cyan)\b)/i.exec(shorthand);
          if (cm) colorStr = cm[1];
        }
      }
    }
    if (!width || width <= 0 || bStyle === "none" || bStyle === "hidden") continue;

    // ── PHASE 3 FIX: Chrome Computed-Style Noise Filter ──────────────────────
    // Chrome's getComputedStyle() dumps border-style + border-color on every
    // element even when border-width is effectively 0 (or was never set).
    // This creates phantom 1px borders on every div/section/header.
    // Rule: if width is 0 or border-width is explicitly declared as 0px,
    // suppress the border even if border-style/color exist.
    if (isBorderWidthExplicitlyZero(style, side)) continue;

    // Filter out default browser button/input user-agent borders if not explicitly styled
    if ((bStyle === "outset" || bStyle === "inset") && (!colorStr || colorStr === "buttonborder" || colorStr === "buttonface" || colorStr === "rgb(118, 118, 118)")) {
      continue;
    }

    // Transparent borders have 0 opacity and must never be rendered as solid black
    if (colorStr === "transparent" || colorStr === "rgba(0, 0, 0, 0)" || colorStr === "rgba(0,0,0,0)") {
      continue;
    }

    // Chrome Paper snapshots: when no width is declared (computed = "0px" but not in inline
    // style), and the border-color exactly matches the element's text color (currentColor
    // inheritance), it is a UA artifact — not a genuine border.
    if (colorStr && style.color === colorStr && UA_DEFAULT_BORDER_COLORS.has(colorStr) &&
        !style[`border-${side}-width`] && !style["border-width"] && !style["border"] && !style[`border-${side}`]) {
      continue;
    }

    const parsedColor = parseColor(colorStr || "");
    if (!parsedColor && !colorStr) {
      // If neither explicit color nor shorthand color was provided, do not synthesize an opaque black border
      continue;
    }

    const color = parsedColor || { hex: colorStr === "white" ? "#FFFFFF" : (colorStr || "#000000"), opacity: 100 };
    const op = color.opacity ?? 100;
    const alpha = op > 1 ? op / 100 : op;
    if (alpha <= 0) continue;

    borders.push({
      side: SIDE_LABEL[side], width, style: bStyle || "solid",
      color: color.hex, opacity: op, alpha,
      paint: { kind: "solid", color: color.hex, alpha },
      visible: true, tokenId: null,
    });
  }
  return borders;
}

export function parseRadius(style) {
  const clampR = (v) => (v != null ? Math.min(9999, Math.max(0, v)) : 0);
  const longhands = [
    px(style["border-top-left-radius"] ?? style["border-start-start-radius"]),
    px(style["border-top-right-radius"] ?? style["border-start-end-radius"]),
    px(style["border-bottom-right-radius"] ?? style["border-end-end-radius"]),
    px(style["border-bottom-left-radius"] ?? style["border-end-start-radius"]),
  ];
  if (longhands.some((v) => v !== null)) {
    const corners = longhands.map((v) => clampR(v));
    const uniform = corners.every((c) => c === corners[0]);
    return { value: uniform ? corners[0] : 0, tokenId: null, corners: uniform ? null : corners };
  }
  const shorthand = style["border-radius"];
  if (typeof shorthand !== "string") return { value: 0, tokenId: null, corners: null };
  const main = shorthand.split("/")[0].trim();
  const vals = main.split(/\s+/).map((t) => {
    const p = px(t);
    return p !== null ? clampR(p) : (percent(t) !== null ? null : 0);
  });
  if (vals.some((v) => v === null)) return { value: 0, tokenId: null, corners: null }; // % radii → rawStyle
  if (!vals.length) return { value: 0, tokenId: null, corners: null };
  const [a, b, c, d] = vals;
  const corners = [a, b ?? a, c ?? a, d ?? b ?? a]; // [tl, tr, br, bl]
  const uniform = corners.every((v) => v === corners[0]);
  return { value: uniform ? a : 0, tokenId: null, corners: uniform ? null : corners };
}

// CSS properties the node model cannot represent; when present in a
// snapshot they are preserved verbatim in node.rawStyle (kebab-case).
const RAW_KEEP = new Set([
  "min-width", "max-width", "min-height", "max-height",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
  "margin-inline-start", "margin-inline-end", "margin-block-start", "margin-block-end",
  "background-position", "background-repeat", "background-size",
  "background-attachment", "background-origin", "background-clip",
  "text-transform", "white-space", "word-break", "overflow-wrap",
  "text-overflow", "text-indent", "vertical-align", "cursor",
  "pointer-events", "user-select", "-webkit-user-select", "object-fit", "object-position",
  "aspect-ratio", "list-style-type", "float", "clear", "visibility",
  "flex-grow", "flex-shrink", "flex-basis", "align-self", "order",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  "transform", "line-clamp", "-webkit-line-clamp",
  // CSS Masking — gradient text, overlay effects
  "mask-image", "-webkit-mask-image",
  "mask-position", "-webkit-mask-position",
  "mask-position-x", "-webkit-mask-position-x",
  "mask-position-y", "-webkit-mask-position-y",
  "mask-size", "-webkit-mask-size",
  "mask-repeat", "-webkit-mask-repeat",
  "mask-origin", "-webkit-mask-origin",
  "mask-clip", "-webkit-mask-clip",
  "mask-mode", "-webkit-mask-mode",
  "mask-composite", "-webkit-mask-composite",
  // Clip path
  "clip-path", "-webkit-clip-path",
  // Text effects
  "text-shadow",
  "-webkit-text-stroke", "-webkit-text-stroke-width", "-webkit-text-stroke-color",
  "letter-spacing",
  "word-spacing",
  // Overflow extras
  "overflow-x", "overflow-y",
  "scroll-behavior", "overscroll-behavior",
  // Writing / direction
  "writing-mode", "direction",
  // Transform extras
  "perspective", "backface-visibility",
  // Filter effects
  "filter", "-webkit-filter", "backdrop-filter", "-webkit-backdrop-filter",
  // Font extras
  "font-variant", "font-stretch", "font-kerning",
  // Text wrap
  "text-wrap", "text-wrap-mode",
  // Text decoration extras
  "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset",
  // Stacking / compositing
  "isolation", "contain",
  // Multi-column
  "column-count", "column-gap", "column-rule",
  // Grid extras
  "grid-template-areas", "grid-auto-rows", "grid-auto-columns", "grid-auto-flow",
  // Performance hint
  "will-change",
]);

// Properties completely represented in core canvas model fields or browser layout defaults (omitted from Other styles)
export function toReactStyleKey(prop) {
  if (!prop || typeof prop !== "string") return "";
  const trimmed = prop.trim();
  if (trimmed.startsWith("--")) return trimmed;
  // If it starts with -tw-, it is a Tailwind reset variable with a single hyphen -> ignore
  if (trimmed.startsWith("-tw-")) return "";
  if (trimmed.startsWith("-ms-")) {
    const rest = trimmed.slice(4).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return "ms" + rest;
  }
  if (trimmed.startsWith("-webkit-")) {
    const rest = trimmed.slice(8).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return "Webkit" + (rest.charAt(0).toUpperCase() + rest.slice(1));
  }
  if (trimmed.startsWith("-moz-")) {
    const rest = trimmed.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return "Moz" + (rest.charAt(0).toUpperCase() + rest.slice(1));
  }
  // Any other single leading dash (like -epub-, -o-, -tw-) is unsupported in React inline styles
  if (trimmed.startsWith("-")) return "";
  return trimmed.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export const CONSUMED_CORE_PROPS = new Set([
  // Positioning and sizing
  "display", "position", "top", "right", "bottom", "left", "inset",
  "inset-block", "inset-block-start", "inset-block-end",
  "inset-inline", "inset-inline-start", "inset-inline-end",
  "width", "height", "inline-size", "block-size", "box-sizing",
  // Backgrounds & fills
  "background-color", "background-image", "background",
  // Physical and logical borders
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-block", "border-block-start", "border-block-end",
  "border-inline", "border-inline-start", "border-inline-end",
  "border-width", "border-style", "border-color",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-block-width", "border-block-start-width", "border-block-end-width",
  "border-block-style", "border-block-start-style", "border-block-end-style",
  "border-block-color", "border-block-start-color", "border-block-end-color",
  "border-inline-width", "border-inline-start-width", "border-inline-end-width",
  "border-inline-style", "border-inline-start-style", "border-inline-end-style",
  "border-inline-color", "border-inline-start-color", "border-inline-end-color",
  // Radii
  "border-radius",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "border-start-start-radius", "border-start-end-radius", "border-end-start-radius", "border-end-end-radius",
  // Shadows & effects
  "box-shadow", "opacity", "mix-blend-mode", "overflow", "overflow-x", "overflow-y", "overflow-block", "overflow-inline", "overflow-clip-margin",
  // Padding
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-block-start", "padding-block-end",
  "padding-inline", "padding-inline-start", "padding-inline-end",
  // Margin (populated into native layout and inspector sidebar controls)
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-block-start", "margin-block-end",
  "margin-inline", "margin-inline-start", "margin-inline-end",
  // Flex layout
  "flex", "flex-grow", "flex-shrink", "flex-basis",
  "flex-direction", "flex-wrap", "flex-flow",
  "gap", "row-gap", "column-gap", "justify-content", "align-items", "align-content",
  "justify-items", "place-content", "place-items",
  // Grid layout
  "grid", "grid-area", "grid-auto-columns", "grid-auto-flow", "grid-auto-rows",
  "grid-column", "grid-column-end", "grid-column-gap", "grid-column-start",
  "grid-gap", "grid-row", "grid-row-end", "grid-row-gap", "grid-row-start",
  "grid-template", "grid-template-areas", "grid-template-columns", "grid-template-rows",
  "justify-self", "align-self", "place-self",
  // Typography & standard color
  "font-family", "font-size", "font-weight", "font-style", "line-height",
  "color", "text-align", "z-index",
  // Browser internal reset noise (filtered out from Other styles)
  "unicode-bidi",
  "appearance", "-webkit-appearance", "-moz-appearance",
  "scrollbar-width", "scrollbar-color",
  "outline", "outline-color", "outline-style", "outline-width", "outline-offset",
  "caret-color",
  "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset",
  "text-emphasis-color", "text-emphasis-style",
  "column-rule", "column-rule-color", "column-rule-style", "column-rule-width",
  "row-rule", "row-rule-color", "row-rule-style", "row-rule-width",
  "-webkit-text-fill-color", "-webkit-text-stroke-color",
]);

/**
 * Predicate to determine whether a CSS property should be excluded from "Other styles".
 * Matches against core model fields, browser engine resets, logical duplicates, and dummy CSS variables.
 */
export function isIgnoredOtherStyle(key, value) {
  if (!key || typeof key !== "string") return true;
  const rawKey = key.trim();
  if (!rawKey) return true;

  // Convert camelCase to kebab-case (e.g. flexDirection -> flex-direction, borderBlockEndColor -> border-block-end-color)
  const kebab = rawKey
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/^([A-Z])/, "-$1")
    .toLowerCase();

  const valStr = value != null && typeof value === "object" ? String(value.value || "").trim() : String(value ?? "").trim();
  const lowerVal = valStr.toLowerCase();

  // 1. Direct match in CONSUMED_CORE_PROPS
  if (CONSUMED_CORE_PROPS.has(kebab) || CONSUMED_CORE_PROPS.has(rawKey.toLowerCase())) {
    return true;
  }

  // 2. Logical borders & paddings
  if (kebab.startsWith("border-block") || kebab.startsWith("border-inline")) return true;
  if (kebab.startsWith("padding-block") || kebab.startsWith("padding-inline")) return true;

  // 3. Margin filtering (0 or auto margins)
  if (kebab.startsWith("margin")) {
    if (!valStr || lowerVal === "0px" || lowerVal === "0" || lowerVal === "auto" || lowerVal === "0 0" || lowerVal === "0px 0px") {
      return true;
    }
  }

  // 4. Dummy reset CSS variables (--tw-*, -tw-*)
  if (kebab.startsWith("--tw-") || kebab.startsWith("-tw-")) {
    if (
      !valStr ||
      lowerVal === "0 0 #0000" ||
      lowerVal === "0 0 rgba(0, 0, 0, 0)" ||
      lowerVal === "0 0 rgba(0,0,0,0)" ||
      lowerVal === "0 0 transparent" ||
      lowerVal === "none" ||
      lowerVal === "initial" ||
      lowerVal === "inherit"
    ) {
      return true;
    }
  }

  // 5. Default/reset values for common noise
  if (lowerVal === "none" && (kebab === "appearance" || kebab === "scrollbar-width" || kebab === "outline" || kebab === "transform")) {
    return true;
  }
  if (lowerVal === "isolate" && kebab === "unicode-bidi") return true;
  if (lowerVal === "auto" && (kebab === "scrollbar-width" || kebab === "z-index" || kebab === "pointer-events")) return true;
  if ((lowerVal === "normal" || lowerVal === "initial" || lowerVal === "inherit") && (kebab === "mix-blend-mode" || kebab === "line-height" || kebab === "letter-spacing")) {
    return true;
  }

  // 6. Zero-width outlines/strokes
  if (kebab.startsWith("outline-") && (lowerVal === "0px" || lowerVal === "0" || lowerVal === "none")) return true;
  if (kebab.startsWith("-webkit-text-stroke") && (lowerVal === "0px" || lowerVal === "0" || lowerVal === "none")) return true;

  return false;
}

export function collectRawStyle(style, handled, tag) {
  const raw = {};
  const s = style || {};
  const lowerTag = tag ? String(tag).toLowerCase() : null;
  for (const [prop, value] of Object.entries(s)) {
    if (value == null || String(value).trim() === "") continue;
    const strVal = String(value).trim();

    // 1. Fully consumed core properties and browser internal noise
    if (CONSUMED_CORE_PROPS.has(prop)) {
      continue;
    }

    // 2. Non-trivial transforms stay in rawStyle
    if (prop === "transform") {
      if (strVal !== "none" && !/^\s*rotate\([^)]*\)\s*$/.test(strVal)) {
        raw[prop] = strVal;
      }
      continue;
    }

    // 3. Margin filtering:
    // Drop 0px / auto margins. Also deduplicate logical margins against physical ones.
    if (prop.startsWith("margin")) {
      if (strVal === "0px" || strVal === "0" || strVal === "auto") continue;
      if (prop === "margin-inline-start" && (s["margin-left"] === strVal || (!s["margin-left"] && strVal === "0px"))) continue;
      if (prop === "margin-inline-end" && (s["margin-right"] === strVal || (!s["margin-right"] && strVal === "0px"))) continue;
      if (prop === "margin-block-start" && (s["margin-top"] === strVal || (!s["margin-top"] && strVal === "0px"))) continue;
      if (prop === "margin-block-end" && (s["margin-bottom"] === strVal || (!s["margin-bottom"] && strVal === "0px"))) continue;
      raw[prop] = strVal;
      continue;
    }

    // 4. Filter Tailwind dummy reset variables:
    // E.g. --tw-shadow: 0 0 #0000; --tw-ring-shadow: 0 0 #0000; --tw-pan-x: ;
    if (prop.startsWith("--")) {
      const isDummyReset =
        strVal === "0 0 #0000" ||
        strVal === "0 0 rgba(0, 0, 0, 0)" ||
        strVal === "0 0 rgba(0,0,0,0)" ||
        strVal === "0 0 transparent" ||
        strVal === "none" ||
        strVal === "initial" ||
        strVal === "inherit";
      if (isDummyReset) continue;
      raw[prop] = strVal;
      continue;
    }

    // 5. Outline noise: skip outline sub-properties when outline-style is missing, none, or browser-default auto
    if (prop.startsWith("outline")) {
      const oStyle = s["outline-style"] || (s.outline && !s.outline.includes("solid") && !s.outline.includes("dashed") && !s.outline.includes("dotted") ? "none" : null);
      const oWidth = s["outline-width"];
      if (oStyle === "none" || oStyle === "auto" || oWidth === "0px" || oWidth === "0" || (!s["outline-style"] && !s.outline)) {
        continue;
      }
    }

    // 6. Overflow logical sub-properties (overflow-block, overflow-inline)
    if (prop === "overflow-block" || prop === "overflow-inline" || prop === "overflow-clip-margin") {
      continue;
    }

    // 7. Stroke / fill noise:
    if (prop === "-webkit-text-stroke-color" || prop === "text-stroke-color") {
      const strokeW = s["-webkit-text-stroke-width"] || s["text-stroke-width"];
      if (!strokeW || strokeW === "0px" || strokeW === "0" || strokeW === "none") continue;
    }
    if (prop === "-webkit-text-fill-color") {
      if (s.color && strVal.toLowerCase() === s.color.trim().toLowerCase()) continue;
    }
    if (prop === "caret-color") {
      if (s.color && strVal.toLowerCase() === s.color.trim().toLowerCase()) continue;
    }

    // 8. Text decoration / emphasis color noise:
    if (prop === "text-decoration-color") {
      const deco = s["text-decoration-line"] || s["text-decoration"];
      if (!deco || deco === "none") continue;
    }
    if (prop === "text-emphasis-color") {
      const emph = s["text-emphasis-style"] || s["text-emphasis"];
      if (!emph || emph === "none") continue;
    }

    // 9. ANY other style (animation, transition, filter, appearance on forms,
    // custom properties, vendor prefixes, and any unrecognized CSS property)
    // is preserved verbatim in rawStyle!
    raw[prop] = strVal;
  }
  return Object.keys(raw).length ? raw : null;
}

export function mapObjectFit(fit) {
  if (!fit || typeof fit !== "string") return null;
  const f = fit.trim().toLowerCase();
  if (f === "contain" || f === "scale-down") return "contain";
  if (f === "fill" || f === "none") return "fill";
  if (f === "cover") return "cover";
  return null;
}

export function buildGoogleFontLinks(fonts) {
  const links = [];
  for (const family of fonts) {
    if (!family || typeof family !== "string") continue;
    const clean = family.trim().replace(/^['"]+|['"]+$/g, "");
    if (!clean) continue;
    const pop = DEFAULT_POPULAR_FONTS?.find((f) => f.family.toLowerCase() === clean.toLowerCase());
    let weightParam = "";
    if (pop?.variants) {
      const numeric = Array.from(
        new Set(
          pop.variants
            .map((v) => (v === "regular" ? "400" : String(v).replace("italic", "")))
            .filter((v) => /^\d+$/.test(v))
        )
      ).sort((a, b) => Number(a) - Number(b));
      if (numeric.length > 0) weightParam = `:wght@${numeric.join(";")}`;
    }
    const href = `https://fonts.googleapis.com/css2?family=${clean.replace(/ /g, "+")}${weightParam}&display=swap`;
    links.push(`<link rel="stylesheet" href="${href}">`);
  }
  return links.join("\n");
}

// ---------------------------------------------------------------------------
// Tree walk — plain elements → model nodes (verified Stages C–E)
// ---------------------------------------------------------------------------

const DROP_TAGS = new Set(["script", "style", "link", "meta", "title", "noscript", "head", "template", "base"]);
const REPLACED_TAGS = new Set(["button", "canvas", "iframe", "img", "input", "object", "select", "svg", "textarea", "video"]);
const FORM_TAGS = new Set(["input", "select", "textarea", "button"]);
const INLINE_TEXT_TAGS = new Set([
  "span", "a", "strong", "em", "b", "i", "u", "s", "strike", "small",
  "sub", "sup", "code", "abbr", "mark", "label", "time", "wbr", "br",
  "font", "cite", "q", "dfn", "var", "samp", "kbd", "data",
]);

export const BLOCK_TAGS = new Set([
  "div", "p", "section", "article", "header", "footer", "nav", "main", "aside",
  "form", "fieldset", "blockquote", "address", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "figure", "figcaption", "table", "details", "summary", "dialog"
]);

export const INLINE_TAGS = new Set([
  "span", "a", "b", "i", "strong", "em", "small", "label", "code", "button",
  "input", "select", "textarea", "img", "svg", "kbd", "sub", "sup", "mark", "time"
]);

/** CSS whitespace collapsing (Stage D) for one raw text string. */
export function collapseWhitespace(raw, mode) {
  if (typeof raw !== "string") return "";
  if (mode === "pre" || mode === "pre-wrap") return raw;
  if (mode === "pre-line") return raw.replace(/[ \t\f\r]+/g, " ").replace(/ ?\n ?/g, "\n");
  return raw.replace(/[\s]+/g, " ");
}

/** Full text content of a plain subtree with whitespace rules applied. */
export function collectText(el, mode) {
  let out = "";
  const walk = (n) => {
    if (typeof n.text === "string") {
      out += n.text;
      return;
    }
    if (n.tag === "br") {
      out += "\n";
      return;
    }
    for (const c of n.children || []) walk(c);
  };
  walk(el);
  const collapsed = collapseWhitespace(out, mode);
  return mode === "pre" || mode === "pre-wrap" ? collapsed : collapsed.trim();
}

// --- Rich-text run collection --------------------------------------------------
// Compares a child element's computed style against baseFont and returns a CSS
// style string containing only the properties that differ. Used by collectRichText.
function spanStyleForDiff(childStyle, baseFont) {
  const parts = [];
  const fw = parseFontWeight(childStyle['font-weight'], false);
  if (fw && fw !== baseFont.weight) parts.push(`font-weight:${fw}`);
  if (/italic|oblique/.test(childStyle['font-style'] || '') !== Boolean(baseFont.italic)) {
    parts.push(`font-style:${/italic|oblique/.test(childStyle['font-style'] || '') ? 'italic' : 'normal'}`);
  }
  const fsPx = px(childStyle['font-size']);
  if (fsPx !== null && Math.round(fsPx) !== Math.round(baseFont.size || 16)) parts.push(`font-size:${fsPx}px`);
  const col = parseColor(childStyle.color || '');
  if (col && baseFont.color && col.hex !== baseFont.color.hex) parts.push(`color:${col.hex}`);
  else if (col && !baseFont.color) parts.push(`color:${col.hex}`);
  const deco = (childStyle['text-decoration-line'] || childStyle['text-decoration'] || '').trim();
  if (deco && deco !== 'none') parts.push(`text-decoration:${deco}`);
  const ff = firstFontFamily(childStyle['font-family']);
  if (ff && ff !== baseFont.family) parts.push(`font-family:${ff}`);
  return parts.join(';');
}

/**
 * Walk the inline subtree of `el`, returning both a plain-text string and an
 * HTML string with `<span style="…">` runs for inline children whose style
 * differs from `baseFont`. If NO child differs, `html` is null.
 *
 * @param {object} el - parsed element node
 * @param {object} baseFont - font descriptor for the parent (from fontFromStyle)
 * @param {string} mode - white-space mode ("normal" | "pre" | "pre-wrap" …)
 * @returns {{ text: string, html: string | null }}
 */
export function collectRichText(el, baseFont, mode) {
  let textAcc = '';
  let htmlAcc = '';
  let anyDiff = false;

  // Escape HTML entities for safe embedding inside span text content
  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Accumulate runs; each run is { style: string|null, text: string }
  // Adjacent runs with same style are merged before serialising.
  const runs = [];
  const pushRun = (styleStr, text) => {
    if (!text) return;
    if (runs.length > 0 && runs[runs.length - 1].style === styleStr) {
      runs[runs.length - 1].text += text;
    } else {
      runs.push({ style: styleStr, text });
    }
  };

  const walk = (n, inheritedStyle) => {
    if (typeof n.text === 'string') {
      // Raw text node
      textAcc += n.text;
      pushRun(null, escHtml(n.text));
      return;
    }
    if (n.tag === 'br') {
      textAcc += '\n';
      pushRun(null, '<br>');
      return;
    }
    const childStyle = n.__style || parseStyleAttribute(n.attrs?.style || '');
    const spanStyle = spanStyleForDiff(childStyle, baseFont);
    if (spanStyle) anyDiff = true;

    // Walk children with the child's style context
    const beforeLen = textAcc.length;
    const beforeHtmlLen = htmlAcc.length;
    // Collect child runs into a temporary list
    const savedRuns = runs.splice(0);
    for (const c of n.children || []) walk(c, childStyle);
    const childRuns = runs.splice(0);
    runs.push(...savedRuns);

    // Build child HTML fragment
    let childHtml = '';
    for (const r of childRuns) {
      if (r.style) {
        childHtml += `<span style="${r.style}">${r.text}</span>`;
      } else {
        childHtml += r.text;
      }
    }

    if (spanStyle) {
      // Wrap the child fragment in a span
      pushRun(null, `<span style="${spanStyle}">${childHtml}</span>`);
    } else {
      // No diff — push child runs back as-is so they can still merge
      for (const r of childRuns) pushRun(r.style, r.text);
    }
  };

  for (const c of el.children || []) walk(c, baseFont);

  // Serialise top-level runs
  for (const r of runs) {
    if (r.style) {
      htmlAcc += `<span style="${r.style}">${r.text}</span>`;
    } else {
      htmlAcc += r.text;
    }
  }

  const collapsed = collapseWhitespace(textAcc, mode);
  const text = mode === 'pre' || mode === 'pre-wrap' ? collapsed : collapsed.trim();
  const html = anyDiff ? htmlAcc : null;
  return { text, html };
}

function firstFontFamily(value) {
  if (typeof value !== "string") return null;
  const first = splitTopLevel(value)[0].trim().replace(/^["']|["']$/g, "");
  return first || null;
}

function parseFontWeight(value, semanticBold) {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "bold" || v === "bolder") return 700;
    if (v === "normal") return 400;
    if (v === "lighter") return 300;
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return semanticBold ? 700 : 400;
}

export function normalizeLineHeight(value, fontSize = 16) {
  if (value == null || value === "" || value === "normal") return 1.25;

  let mult = null;
  if (typeof value === "number") {
    mult = value;
  } else if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "normal") return 1.25;
    if (v.endsWith("%")) {
      mult = parseFloat(v) / 100;
    } else if (v.endsWith("px")) {
      const pxVal = parseFloat(v);
      mult = fontSize > 0 ? pxVal / fontSize : 1.25;
    } else if (v.endsWith("em") || v.endsWith("rem")) {
      mult = parseFloat(v);
    } else {
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return 1.25;
      mult = n;
    }
  }

  if (mult == null || !Number.isFinite(mult)) return 1.25;

  // If mult was passed as a percentage like 120, 140, 150
  if (mult > 5) {
    if (fontSize > 0 && mult / fontSize <= 2.5) {
      mult = mult / fontSize;
    } else {
      mult = mult / 100;
    }
  }

  // Only clamp truly nonsensical values; legitimate designs can use 1.5–3.0 line height
  if (mult > 10 || mult < 0.5) {
    return 1.25;
  }

  return Math.round(mult * 100) / 100;
}

function lineHeightPercent(value, fontSize) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return normalizeLineHeight(value, fontSize || 16);
}

function letterSpacingPercent(value, fontSize) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const v = String(value).trim();
  if (v === "normal") return 0;
  if (v.endsWith("px")) {
    const p = px(v);
    return p !== null ? `${p}px` : null;
  }
  const pc = percent(v);
  if (pc !== null) return pc;
  const p = px(v);
  if (p !== null) return `${p}px`;
  return null;
}

/** Inherit + override the running font context from an element's style. */
function fontFromStyle(style, parent, semantic) {
  const f = { ...parent };
  const family = firstFontFamily(style["font-family"]);
  if (family) f.family = family;
  const sizePx = px(style["font-size"]);
  if (sizePx !== null) f.size = sizePx;
  else {
    const pc = percent(style["font-size"]);
    if (pc !== null && parent.size) f.size = (pc / 100) * parent.size;
  }
  if (style["font-weight"] !== undefined || semantic.bold) {
    f.weight = parseFontWeight(style["font-weight"], semantic.bold);
  }
  if (semantic.italic) f.italic = true;
  else if (typeof style["font-style"] === "string") {
    f.italic = /italic|oblique/.test(style["font-style"]);
  }
  const lh = lineHeightPercent(style["line-height"], f.size);
  if (lh !== null) f.lineHeight = lh;
  const ls = letterSpacingPercent(style["letter-spacing"], f.size);
  if (ls !== null) f.letterSpacing = ls;
  const color = parseColor(style.color || "");
  if (color) f.color = color;
  if (typeof style["text-align"] === "string") {
    const a = style["text-align"].trim();
    if (["left", "right", "center", "justify"].includes(a)) f.alignX = a;
  }
  return f;
}

const DEFAULT_FONT = {
  family: null, size: 16, weight: 400, italic: false,
  lineHeight: null, letterSpacing: 0, color: null, alignX: "left",
};

function hasVisibleBox(style) {
  const bg = parseColor(style["background-color"] || "");
  if (bg && bg.opacity > 0) return true;
  // background-image is a text-clip effect (gradient text), NOT a visible box
  const isTextClip = style["background-clip"] === "text" || style["-webkit-background-clip"] === "text";
  if (typeof style["background-image"] === "string" && style["background-image"] !== "none" && !isTextClip) return true;
  if (parseBorders(style).length) return true;
  if (typeof style["box-shadow"] === "string" && style["box-shadow"] !== "none") return true;
  return false;
}

/**
 * Stage D test: can this element's whole subtree collapse into ONE
 * text node? All descendants must be inline text-level elements, the
 * element must not be a layout container (flex/grid) or a replaced /
 * form element, and it must not carry a visible box of its own (a
 * chip's background belongs to a frame, not to its label).
 */
export function isTextCollapsible(el, style) {
  if (!el || typeof el.text === "string") return false;
  if (REPLACED_TAGS.has(el.tag) || FORM_TAGS.has(el.tag)) return false;
  const display = style.display || "";
  if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") return false;
  if (!el.children || el.children.length === 0) return false;
  if (hasVisibleBox(style)) return false;
  const allInline = (n) => {
    for (const c of n.children || []) {
      if (typeof c.text === "string") continue;
      const original = (c.attrs && c.attrs["paper-snapshot-original-tag"]) || c.tag;
      if (!INLINE_TEXT_TAGS.has(original.toLowerCase()) && !INLINE_TEXT_TAGS.has(c.tag)) return false;
      if (REPLACED_TAGS.has(c.tag)) return false;
      if (!allInline(c)) return false;
    }
    return true;
  };
  return allInline(el);
}

function isContainingBlock(style) {
  if (["relative", "absolute", "fixed", "sticky"].includes(style.position)) return true;
  if (typeof style.transform === "string" && style.transform !== "none") return true;
  return false;
}

const HANDLED_PROPS = new Set([
  "display", "position", "top", "right", "bottom", "left", "inset",
  "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end",
  "width", "height", "box-sizing", "background-color", "background-image", "background",
  "border", "border-width", "border-style", "border-color", "border-radius",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "box-shadow", "opacity", "mix-blend-mode", "overflow", "overflow-x", "overflow-y",
  "transform", "z-index", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "flex-direction", "flex-wrap", "gap", "row-gap", "column-gap",
  "justify-content", "align-items", "font-family", "font-size", "font-weight",
  "font-style", "line-height", "letter-spacing", "color", "text-align",
  "text-decoration-line", "text-decoration",
  "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset",
  "-webkit-font-smoothing", "-moz-osx-font-smoothing", "font-smoothing",
  // Filter effects
  "filter", "backdrop-filter", "-webkit-backdrop-filter",
  // Flex alignment extras
  "align-content", "align-self", "place-items", "place-content", "place-self",
  "flex-flow", "flex",
  // Grid extras
  "grid-area", "grid-template-areas", "grid-auto-rows", "grid-auto-columns", "grid-auto-flow",
  // Font extras
  "font-variant", "font-stretch",
  // Stacking
  "isolation",
]);

/** Apply an element's box styles to a frame/rect node. Returns nothing; records layout info. */
function applyBoxStyles(node, style, info, ctx = null, tag = "") {
  const fills = [];
  // background-image layers paint above background-color.
  const isTextClip = style["background-clip"] === "text" || style["-webkit-background-clip"] === "text";
  let bgLayers = !isTextClip ? parseBackgroundImage(style["background-image"]) : [];
  if (!bgLayers.length && typeof style.background === "string" && !isTextClip) {
    bgLayers = parseBackgroundImage(style.background);
    if (!bgLayers.length) {
      const cm = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|oklch\([^)]*\))/.exec(style.background);
      if (cm) {
        const c = parseColor(cm[1]);
        if (c && c.opacity > 0) fills.push(createPaint({ type: "solid", color: c.hex, opacity: c.opacity }));
      }
    }
  }
  for (const layer of bgLayers) {
    if (layer.type === "gradient") {
      fills.push(createPaint({ type: "gradient", gradient: layer.gradient }));
    } else if (layer.type === "image" && layer.src) {
      const imgFit = mapObjectFit(style["object-fit"]) || "fill";
      const paint = createPaint({ type: "image", image: { src: layer.src, fit: imgFit } });
      fills.push(paint);
      info.imagePaintIds.push(paint.id);
    }
  }
  const bg = parseColor(style["background-color"] || "");
  if (bg && bg.opacity > 0) fills.push(createPaint({ type: "solid", color: bg.hex, opacity: bg.opacity }));
  node.fills = fills;

  node.borders = parseBorders(style);
  node.radius = parseRadius(style);
  const shadows = parseBoxShadow(style["box-shadow"]);
  node.shadows = shadows.outer;
  node.innerShadows = shadows.inner;
  const op = parseFloat(style.opacity);
  if (Number.isFinite(op)) node.opacity = Math.round(Math.min(1, Math.max(0, op)) * 100);
  const blend = BLEND_BY_CSS[(style["mix-blend-mode"] || "").trim()];
  if (blend) node.blendMode = blend;
  const ov = (style.overflow || "").trim().toLowerCase();
  const ovX = (style["overflow-x"] || "").trim().toLowerCase();
  const ovY = (style["overflow-y"] || "").trim().toLowerCase();
  if (
    ov === "hidden" || ov === "clip" ||
    ovX === "hidden" || ovX === "clip" ||
    ovY === "hidden" || ovY === "clip" ||
    ov.includes("hidden") || ov.includes("clip")
  ) {
    node.clipContent = true;
  }
  if (typeof style.transform === "string" && style.transform !== "none") {
    const rot = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(style.transform);
    if (rot) node.rotation = parseFloat(rot[1]);
  }

  // Sizing — layout-aware inference & resolved px.
  const display = (style.display || "").trim().toLowerCase();
  const rawW = (style.width || style["inline-size"] || "").trim().toLowerCase();
  const wPx = px(rawW);
  const wPc = percent(rawW);
  const minW = px(style["min-width"] || style["min-inline-size"]);
  const maxW = px(style["max-width"] || style["max-inline-size"]);
  const isPos = style.position === "absolute" || style.position === "fixed";
  const parentFlexDir = ctx?.parentFlexDir;
  const parentAlignItems = (ctx?.parentAlignItems || "stretch").toLowerCase();
  const alignSelf = (style["align-self"] || "auto").toLowerCase();
  const effectiveAlign = alignSelf !== "auto" ? alignSelf : parentAlignItems;
  const flexGrow = parseFloat(style["flex-grow"]);
  const flexGrowActive = Number.isFinite(flexGrow) && flexGrow >= 1;

  if (rawW === "fit-content" || rawW === "max-content" || rawW === "min-content" || rawW === "fit" || rawW === "hug") {
    node.wMode = "Fit";
  } else if (wPc !== null && wPc >= 98) {
    // 100% width means fill parent
    node.wMode = "Fill";
    if (ctx?.parentContentW != null && !info.meas) {
      node.w = ctx.parentContentW;
    }
  } else if (rawW === "100%" || rawW === "100vw" || rawW === "fill") {
    node.wMode = "Fill";
    if (ctx?.parentContentW != null && !info.meas) {
      node.w = ctx.parentContentW;
    }
  } else if (wPx !== null) {
    node.w = Math.round(wPx * 100) / 100;
    node.wMode = "Fixed";
  } else if (wPc !== null) {
    node.w = wPc;
    node.wMode = "Relative";
    if (ctx?.parentContentW != null && !info.meas) {
      node.w = Math.round((ctx.parentContentW * wPc) / 100 * 100) / 100;
    }
  } else if (rawW === "auto" || rawW === "") {
    // Sizing inference based on parent layout, display, and positioning
    if (isPos) {
      const leftVal = px(style.left);
      const rightVal = px(style.right);
      if (leftVal !== null && rightVal !== null && ctx?.parentContentW != null) {
        node.w = Math.max(0, ctx.parentContentW - leftVal - rightVal);
        node.wMode = "Fixed";
      } else {
        node.wMode = "Fit";
      }
    } else if (parentFlexDir === "column") {
      // In flex column, cross-axis alignment defaults to stretch (fills container width)
      if (effectiveAlign === "stretch") {
        node.wMode = "Fill";
        if (ctx?.parentContentW != null && !info.meas) {
          const marginH = (info.margin?.left || 0) + (info.margin?.right || 0);
          node.w = Math.max(0, ctx.parentContentW - marginH);
        }
      } else {
        node.wMode = "Fit";
      }
    } else if (parentFlexDir === "row") {
      // In flex row, main axis is horizontal; flex-grow fills remaining space
      if (flexGrowActive) {
        node.wMode = "Fill";
      } else {
        node.wMode = "Fit";
      }
    } else if (ctx?.parentGridCols) {
      // Grid children stretch across their assigned track by default
      const justifySelf = (style["justify-self"] || ctx?.parentJustifyItems || "stretch").toLowerCase();
      if (justifySelf === "stretch") {
        node.wMode = "Fill";
      } else {
        node.wMode = "Fit";
      }
    } else if (display === "inline" || display === "inline-block" || display === "inline-flex" || (INLINE_TAGS.has(tag) && display !== "block" && display !== "flex" && display !== "grid")) {
      node.wMode = "Fit";
    } else if (BLOCK_TAGS.has(tag) || display === "block" || display === "flex" || display === "grid" || node.type === "frame") {
      // Block-level elements in normal flow fill the available parent content width
      node.wMode = "Fill";
      if (ctx?.parentContentW != null && !info.meas) {
        const marginH = (info.margin?.left || 0) + (info.margin?.right || 0);
        node.w = Math.max(0, ctx.parentContentW - marginH);
      }
    } else {
      node.wMode = "Fit";
    }
  } else {
    node.wMode = "Fit";
  }

  const rawH = (style.height || style["block-size"] || "").trim().toLowerCase();
  const hPx = px(rawH);
  const hPc = percent(rawH);
  const minH = px(style["min-height"] || style["min-block-size"]);
  const maxH = px(style["max-height"] || style["max-block-size"]);

  if (rawH === "fit-content" || rawH === "max-content" || rawH === "min-content" || rawH === "fit" || rawH === "hug") {
    node.hMode = "Fit";
  } else if (hPc !== null && hPc >= 98) {
    node.hMode = "Fill";
    if (ctx?.parentContentH != null && !info.meas) node.h = ctx.parentContentH;
  } else if (rawH === "100%" || rawH === "100vh" || rawH === "fill") {
    node.hMode = "Fill";
    if (ctx?.parentContentH != null && !info.meas) node.h = ctx.parentContentH;
  } else if (hPx !== null) {
    node.h = Math.round(hPx * 100) / 100;
    node.hMode = "Fixed";
  } else if (hPc !== null) {
    node.h = hPc;
    node.hMode = "Relative";
    if (ctx?.parentContentH != null && !info.meas) node.h = Math.round((ctx.parentContentH * hPc) / 100 * 100) / 100;
  } else if (rawH === "auto" || rawH === "") {
    if (parentFlexDir === "column" && flexGrowActive && !isPos) {
      node.hMode = "Fill";
    } else {
      node.hMode = "Fit";
    }
  } else {
    node.hMode = "Fit";
  }

  // Render-pass measurements (browser imports - GROUND TRUTH):
  // When browser measurement is available, capture the exact rendered geometry!
  if (info.meas) {
    if (typeof info.meas.w === "number" && info.meas.w > 0) {
      node.w = Math.round(info.meas.w * 100) / 100;
    }
    if (typeof info.meas.h === "number" && info.meas.h > 0) {
      node.h = Math.round(info.meas.h * 100) / 100;
    }
    if (!node.wMode) node.wMode = "Fixed";
    if (!node.hMode) node.hMode = "Fixed";
  }

  // Min / max dimension clamping and constraints
  if (minW !== null) {
    node.minWidth = minW;
    if (typeof node.w === "number" && node.w < minW) node.w = minW;
  }
  if (maxW !== null) {
    node.maxWidth = maxW;
    if (typeof node.w === "number" && node.w > maxW) {
      node.w = maxW;
      if (ctx?.parentContentW != null && maxW < ctx.parentContentW - 2) {
        node.wMode = "Fixed";
      }
    }
  }
  if (minH !== null) {
    node.minHeight = minH;
    if (typeof node.h === "number" && node.h < minH) node.h = minH;
  }
  if (maxH !== null) {
    node.maxHeight = maxH;
    if (typeof node.h === "number" && node.h > maxH) node.h = maxH;
  }
  if (info?.centerX) node.centerX = true;
  if (info?.centerY) node.centerY = true;
  const effDisplay = display || info.meas?.computedDisplay || "";
  if (effDisplay === "flex" || effDisplay === "inline-flex" || effDisplay.includes("flex")) {
    const flex = defaultFlex();
    const dir = (style["flex-direction"] || info.meas?.computedFlexDirection || "row").trim();
    flex.direction = dir.startsWith("column") ? "column" : "row";
    flex.reverse = dir.endsWith("-reverse");
    flex.wrap = (style["flex-wrap"] || info.meas?.computedFlexWrap || "").startsWith("wrap");
    const gapParts = typeof style.gap === "string" ? style.gap.trim().split(/\s+/).map((t) => px(t)) : [];
    const rowGap = px(style["row-gap"]) ?? px(info.meas?.computedRowGap) ?? gapParts[0] ?? null;
    const colGap = px(style["column-gap"]) ?? px(info.meas?.computedColumnGap) ?? gapParts[1] ?? gapParts[0] ?? null;
    const mainGap = flex.direction === "column" ? rowGap : colGap;
    if (mainGap !== null) flex.gap = { value: mainGap, tokenId: null };
    const rawJustify = (style["justify-content"] || info.meas?.computedJustifyContent || "").trim();
    const justify = {
      "flex-start": "start",
      start: "start",
      center: "center",
      "flex-end": "end",
      end: "end",
      "space-between": "space-between",
      "space-around": "space-around",
      "space-evenly": "space-evenly",
    }[rawJustify];
    if (justify) flex.alignMain = justify;
    const rawAlign = (style["align-items"] || info.meas?.computedAlignItems || "").trim();
    const align = {
      "flex-start": "start",
      start: "start",
      center: "center",
      "flex-end": "end",
      end: "end",
      stretch: "stretch",
      baseline: "baseline",
    }[rawAlign];
    if (align) flex.alignCross = align;
    const pad = parseBoxEdges(style, "padding");
    for (const side of BORDER_SIDES) {
      if (pad[side] !== null) flex.padding[side] = { value: pad[side], tokenId: null };
    }
    node.flex = flex;
    info.isFlex = true;
  } else if (effDisplay === "grid" || effDisplay === "inline-grid" || effDisplay.includes("grid")) {
    const pad = parseBoxEdges(style, "padding");
    node.grid = {
      mode: "grid",
      display: effDisplay.includes("inline") ? "inline-grid" : "grid",
      columns: style["grid-template-columns"] || info.meas?.computedGridTemplateColumns || "repeat(2, 1fr)",
      rows: style["grid-template-rows"] || info.meas?.computedGridTemplateRows || "auto",
      autoFlow: style["grid-auto-flow"] || info.meas?.computedGridAutoFlow || "row",
      autoColumns: style["grid-auto-columns"] || "auto",
      autoRows: style["grid-auto-rows"] || "auto",
      columnGap: px(style["column-gap"]) ?? px(info.meas?.computedColumnGap) ?? px(style.gap) ?? 0,
      rowGap: px(style["row-gap"]) ?? px(info.meas?.computedRowGap) ?? px(style.gap) ?? 0,
      gap: px(style.gap) ?? px(style["column-gap"]) ?? 0,
      rowGap: px(style["row-gap"]) ?? px(style.gap) ?? 0,
      gap: px(style.gap) ?? px(style["column-gap"]) ?? 0,
      justifyItems: style["justify-items"] || "stretch",
      alignItems: style["align-items"] || "stretch",
      justifyContent: style["justify-content"] || "start",
      alignContent: style["align-content"] || "start",
      areas: style["grid-template-areas"] || "",
      padding: {
        t: pad.top ?? 0,
        r: pad.right ?? 0,
        b: pad.bottom ?? 0,
        l: pad.left ?? 0,
        h: pad.left ?? 0,
        v: pad.top ?? 0,
      },
    };
    info.isGrid = true;
    info.grid = {
      templateColumns: node.grid.columns,
      rowGap: node.grid.rowGap,
      colGap: node.grid.columnGap,
    };
  }

  // Child grid item placement
  if (
    style["grid-column"] ||
    style["grid-column-start"] ||
    style["grid-column-end"] ||
    style["grid-row"] ||
    style["grid-row-start"] ||
    style["grid-row-end"] ||
    style["grid-area"] ||
    style["justify-self"] ||
    style["align-self"] ||
    style["order"]
  ) {
    node.gridLayout = {
      gridColumn: style["grid-column"] || undefined,
      gridColumnStart: style["grid-column-start"] || undefined,
      gridColumnEnd: style["grid-column-end"] || undefined,
      gridRow: style["grid-row"] || undefined,
      gridRowStart: style["grid-row-start"] || undefined,
      gridRowEnd: style["grid-row-end"] || undefined,
      gridArea: style["grid-area"] || undefined,
      justifySelf: style["justify-self"] || undefined,
      alignSelf: style["align-self"] || undefined,
      order: style["order"] ? parseInt(style["order"], 10) : undefined,
    };
  }

  if (info.padding.top || info.padding.right || info.padding.bottom || info.padding.left) {
    node.padding = {
      t: info.padding.top || 0,
      r: info.padding.right || 0,
      b: info.padding.bottom || 0,
      l: info.padding.left || 0,
      h: info.padding.left || 0,
      v: info.padding.top || 0,
    };
  }
  if (info.margin.top || info.margin.right || info.margin.bottom || info.margin.left) {
    node.margin = {
      t: info.margin.top || 0,
      r: info.margin.right || 0,
      b: info.margin.bottom || 0,
      l: info.margin.left || 0,
      h: info.margin.left || 0,
      v: info.margin.top || 0,
    };
  }

  node.rawStyle = collectRawStyle(style, HANDLED_PROPS, tag);
}

function makeTextNode(text, font, style, el, conv, opts = {}) {
  const inheritSize = opts.size !== false;
  const node = createNode("text", { fills: [] });
  const deco = `${style["text-decoration-line"] || ""} ${style["text-decoration"] || ""}`;
  const transform = (font.textTransform || style["text-transform"] || "").trim().toLowerCase();
  let content = text;
  if (transform === "uppercase") content = content.toUpperCase();
  else if (transform === "lowercase") content = content.toLowerCase();

  const rawWs = (style["white-space"] || font.whiteSpace || "").trim().toLowerCase();
  const isExplicitNowrap = rawWs === "nowrap" || rawWs === "pre";

  node.text = {
    ...(node.text || {}),
    content,
    wrap: isExplicitNowrap ? "none" : "wrap",
    fontFamily: font.family || node.text?.fontFamily || "Inter",
    fontWeight: font.weight,
    fontSize: font.size,
    fontStyle: font.italic ? "Italic" : "Regular",
    lineHeight: font.lineHeight ?? node.text?.lineHeight ?? 1.25,
    letterSpacing: font.letterSpacing,
    alignX: font.alignX,
    underline: deco.includes("underline") || conv.semantic.underline,
    textTransform: transform || undefined,
    truncation: style["text-overflow"] === "ellipsis" || Boolean(conv.semantic?.truncate) || undefined,
  };

  // Apply rich-text HTML runs if provided
  if (opts.html) {
    node.text.html = opts.html;
  }

  // --- Gradient text detection: background-clip:text + background-image:gradient ---
  const isTextClip = style["background-clip"] === "text" || style["-webkit-background-clip"] === "text";
  const bgImage = style["background-image"] || "";
  const hasGradient = bgImage && bgImage !== "none" && (bgImage.includes("gradient(") || bgImage.includes("-gradient("));

  if (isTextClip && hasGradient) {
    // Parse the gradient and use it as the text node fill
    const bgLayers = parseBackgroundImage(bgImage);
    const gradFills = [];
    for (const layer of bgLayers) {
      if (layer.type === "gradient") {
        gradFills.push(createPaint({ type: "gradient", gradient: layer.gradient }));
      }
    }
    if (gradFills.length > 0) {
      node.fills = gradFills;
      // Store background-clip + text-fill-color in rawStyle so CanvasNode applies them
      node.rawStyle = {
        ...(node.rawStyle || {}),
        "background-clip": "text",
        "-webkit-background-clip": "text",
        "-webkit-text-fill-color": "transparent",
      };
      // Collect any mask-image / clip-path / other visual extras
      const extraRaw = collectRawStyle(style, HANDLED_PROPS, el?.tag);
      if (extraRaw) {
        node.rawStyle = { ...extraRaw, ...node.rawStyle };
      }
    } else {
      // Gradient parse failed — fall back to solid color
      if (font.color && font.color.opacity > 0) {
        node.fills = [createPaint({ type: "solid", color: font.color.hex, opacity: font.color.opacity })];
      }
    }
  } else if (font.color && font.color.opacity > 0) {
    node.fills = [createPaint({ type: "solid", color: font.color.hex, opacity: font.color.opacity })];
  } else if (font.color) {
    node.fills = [createPaint({ type: "solid", color: font.color.hex, opacity: font.color.opacity })];
  }

  if (inheritSize) {
    const wPx = px(style.width);
    const hPx = px(style.height);
    if (wPx !== null) {
      node.w = Math.round(wPx * 100) / 100;
      node.wMode = "Fixed";
    } else {
      if (opts.meas) node.w = Math.round(opts.meas.w * 100) / 100;
      node.wMode = "Fit";
    }
    if (hPx !== null) {
      node.h = Math.round(hPx * 100) / 100;
      node.hMode = "Fixed";
    } else {
      if (opts.meas) node.h = Math.round(opts.meas.h * 100) / 100;
      node.hMode = "Fit";
    }
    if (!isTextClip) {
      // Only collect rawStyle here if not already set by gradient text path above
      node.rawStyle = collectRawStyle(style, HANDLED_PROPS, el?.tag);
    }
  } else {
    if (opts.meas) {
      node.w = Math.round(opts.meas.w * 100) / 100;
      node.h = Math.round(opts.meas.h * 100) / 100;
    }
    node.wMode = "Fit";
    node.hMode = "Fit";
    if (!isTextClip) {
      node.rawStyle = collectRawStyle(style, HANDLED_PROPS, el?.tag);
    }
  }
  const rawExtra = collectRawStyle(style, HANDLED_PROPS, el?.tag);
  if (rawExtra) {
    node.rawStyle = { ...(rawExtra || {}), ...(node.rawStyle || {}) };
  }
  const op = parseFloat(style.opacity);
  node.opacity = Number.isFinite(op) ? Math.round(Math.min(1, Math.max(0, op)) * 100) : (node.opacity ?? 100);
  if (el && el.__placeholder) node.opacity = Math.round(node.opacity * 0.5);
  return node;
}

const FORM_LABELS = { input: "Input", select: "Select", textarea: "Text Area", button: "Button" };

function convertShapeToPathData(c) {
  const tag = (c.tag || "").toLowerCase();
  if (tag === "path") {
    return c.attrs?.d || "";
  }
  if (tag === "polygon") {
    const coords = (c.attrs?.points || "").trim().match(/-?[\d.]+(?:e-?\d+)?/gi);
    if (coords && coords.length >= 4) {
      let d = `M ${coords[0]} ${coords[1]}`;
      for (let i = 2; i < coords.length - 1; i += 2) {
        d += ` L ${coords[i]} ${coords[i + 1]}`;
      }
      return d + " Z";
    }
    return "";
  }
  if (tag === "polyline") {
    const coords = (c.attrs?.points || "").trim().match(/-?[\d.]+(?:e-?\d+)?/gi);
    if (coords && coords.length >= 4) {
      let d = `M ${coords[0]} ${coords[1]}`;
      for (let i = 2; i < coords.length - 1; i += 2) {
        d += ` L ${coords[i]} ${coords[i + 1]}`;
      }
      return d;
    }
    return "";
  }
  if (tag === "line") {
    const x1 = parseFloat(c.attrs?.x1) || 0;
    const y1 = parseFloat(c.attrs?.y1) || 0;
    const x2 = parseFloat(c.attrs?.x2) || 0;
    const y2 = parseFloat(c.attrs?.y2) || 0;
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  if (tag === "rect") {
    const x = parseFloat(c.attrs?.x) || 0;
    const y = parseFloat(c.attrs?.y) || 0;
    const rw = parseFloat(c.attrs?.width) || 0;
    const rh = parseFloat(c.attrs?.height) || 0;
    const rx = parseFloat(c.attrs?.rx) || 0;
    const ry = parseFloat(c.attrs?.ry) || rx || 0;
    if (rw > 0 && rh > 0) {
      if (rx > 0 || ry > 0) {
        const effRx = Math.min(rx || ry, rw / 2);
        const effRy = Math.min(ry || rx, rh / 2);
        return `M ${x + effRx} ${y} h ${rw - 2 * effRx} a ${effRx} ${effRy} 0 0 1 ${effRx} ${effRy} v ${rh - 2 * effRy} a ${effRx} ${effRy} 0 0 1 -${effRx} ${effRy} h -${rw - 2 * effRx} a ${effRx} ${effRy} 0 0 1 -${effRx} -${effRy} v -${rh - 2 * effRy} a ${effRx} ${effRy} 0 0 1 ${effRx} -${effRy} Z`;
      }
      return `M ${x} ${y} h ${rw} v ${rh} h -${rw} Z`;
    }
    return "";
  }
  if (tag === "circle") {
    const cx = parseFloat(c.attrs?.cx) || 0;
    const cy = parseFloat(c.attrs?.cy) || 0;
    const r = parseFloat(c.attrs?.r) || 0;
    if (r > 0) {
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 -${2 * r} 0 Z`;
    }
    return "";
  }
  if (tag === "ellipse") {
    const cx = parseFloat(c.attrs?.cx) || 0;
    const cy = parseFloat(c.attrs?.cy) || 0;
    const rx = parseFloat(c.attrs?.rx) || 0;
    const ry = parseFloat(c.attrs?.ry) || 0;
    if (rx > 0 && ry > 0) {
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 -${2 * rx} 0 Z`;
    }
    return "";
  }
  return "";
}

function buildSvgChildren(parentEl, parentNode, conv, inherited = {}) {
  if (!parentEl || !parentEl.children) return;

  for (const childEl of parentEl.children) {
    if (!childEl || typeof childEl.text === "string") continue;
    const tag = (childEl.tag || "").toLowerCase();
    if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "style" || tag === "title" || tag === "desc" || tag === "metadata") {
      continue;
    }

    const cStyle = parseStyleAttribute(childEl.attrs?.style || "");
    const attrs = childEl.attrs || {};

    const rawFill = attrs.fill ?? cStyle.fill ?? inherited.fill;
    const rawStroke = attrs.stroke ?? cStyle.stroke ?? inherited.stroke;
    const rawStrokeWidth = attrs["stroke-width"] ?? cStyle["stroke-width"] ?? inherited.strokeWidth;
    const strokeLinecap = attrs["stroke-linecap"] ?? cStyle["stroke-linecap"] ?? inherited.strokeLinecap ?? "round";
    const strokeLinejoin = attrs["stroke-linejoin"] ?? cStyle["stroke-linejoin"] ?? inherited.strokeLinejoin ?? "round";
    const fillRule = attrs["fill-rule"] ?? cStyle["fill-rule"] ?? inherited.fillRule ?? "nonzero";
    const clipRule = attrs["clip-rule"] ?? cStyle["clip-rule"] ?? inherited.clipRule;
    const transform = attrs.transform ?? cStyle.transform ?? null;
    const rawOpacity = attrs.opacity ?? cStyle.opacity ?? inherited.opacity;
    const opacity = rawOpacity != null ? parseFloat(rawOpacity) : 1;

    let fill = rawFill;
    let stroke = rawStroke;
    if (fill === "none" || fill === "transparent") fill = null;
    if (stroke === "none" || stroke === "transparent") stroke = null;
    if (fill === "currentColor") fill = inherited.color || "#18181B";
    if (stroke === "currentColor") stroke = inherited.color || "#18181B";

    const parsedFill = fill ? (parseColor(fill)?.hex || fill) : null;
    const parsedStroke = stroke ? (parseColor(stroke)?.hex || stroke) : null;
    const strokeWidth = parseFloat(rawStrokeWidth) || (parsedStroke ? 1.3 : 0);

    const hasExplicitStroke = Boolean(
      (attrs.stroke && attrs.stroke !== "none" && attrs.stroke !== "transparent") ||
      (cStyle.stroke && cStyle.stroke !== "none" && cStyle.stroke !== "transparent")
    );
    const hasVisibleStroke = Boolean(parsedStroke && strokeWidth > 0 && stroke !== "none" && stroke !== "transparent");
    const isTransparentFill = !fill || fill === "none" || fill === "transparent" || attrs.fill === "none" || cStyle.fill === "none" || (parsedFill && parseColor(parsedFill)?.opacity === 0);

    if (tag === "rect" && isTransparentFill && !hasVisibleStroke && !hasExplicitStroke) {
      // Invisible SVG bounding-box / viewBox click target (e.g. <rect width="24" height="24" fill="none" />).
      // The parent <svg> already carries the width, height, and viewBox.
      // Skip generating an artificial "Rectangle" child layer!
      continue;
    }

    const childStyles = {
      ...inherited,
      fill: rawFill,
      stroke: rawStroke,
      strokeWidth: rawStrokeWidth,
      strokeLinecap,
      strokeLinejoin,
      fillRule,
      clipRule,
      opacity,
    };

    if (tag === "g") {
      const groupNode = createNode("group", {
        parentId: parentNode.id,
        childIds: [],
        position: { x: 0, y: 0 },
        size: {
          w: { kind: "fixed", px: parentNode.w || 24 },
          h: { kind: "fixed", px: parentNode.h || 24 },
        },
        transform: transform || undefined,
        fillRule,
        clipRule: clipRule || undefined,
        style: {
          opacity: Number.isFinite(opacity) ? opacity : 1,
          fill: parsedFill ? { kind: "solid", color: parsedFill } : null,
          stroke: parsedStroke ? { width: strokeWidth, paint: { kind: "solid", color: parsedStroke, alpha: 1 } } : null,
        },
      });
      if (attrs.id) {
        const clean = attrs.id.replace(/^#/, "");
        groupNode.name = clean.charAt(0).toUpperCase() + clean.slice(1);
      }
      conv.byId.set(groupNode.id, groupNode);
      conv.all.push(groupNode);
      parentNode.childIds.push(groupNode.id);

      buildSvgChildren(childEl, groupNode, conv, childStyles);
      continue;
    }

    const d = convertShapeToPathData(childEl);
    if (!d) continue;

    let nodeName = tag === "polygon" ? "Polygon" : (tag === "circle" ? "Circle" : (tag === "rect" ? "Rectangle" : "Path"));
    if (attrs.id) {
      const clean = attrs.id.replace(/^#/, "");
      nodeName = clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    // Default fill if neither fill nor stroke is given, unless explicitly set to none
    const isExplicitNoneFill = rawFill === "none" || rawFill === "transparent" || cStyle.fill === "none";
    const effectiveFill = isExplicitNoneFill ? null : (parsedFill || (parsedStroke ? null : (inherited.color || "#18181B")));

    if (!effectiveFill && !hasVisibleStroke) {
      // Shape has neither visible fill nor visible stroke
      continue;
    }

    const childNode = createNode(tag === "polygon" ? "polygon" : "path", {
      name: nodeName,
      parentId: parentNode.id,
      childIds: [],
      position: { x: 0, y: 0 },
      size: {
        w: { kind: "fixed", px: parentNode.w || 24 },
        h: { kind: "fixed", px: parentNode.h || 24 },
      },
      viewBox: parentNode.viewBox || inherited.viewBox || undefined,
      d,
      fillRule,
      clipRule: clipRule || undefined,
      strokeLinecap,
      strokeLinejoin,
      transform: transform || undefined,
      fill: effectiveFill || "none",
      stroke: parsedStroke || undefined,
      strokeWidth: parsedStroke ? strokeWidth : 0,
      style: {
        fill: effectiveFill ? { kind: "solid", color: effectiveFill } : null,
        stroke: parsedStroke ? { width: strokeWidth, paint: { kind: "solid", color: parsedStroke, alpha: 1 } } : null,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        fillRule,
        clipRule: clipRule || undefined,
      },
    });

    conv.byId.set(childNode.id, childNode);
    conv.all.push(childNode);
    parentNode.childIds.push(childNode.id);
  }
}

function buildElement(el, ctx, conv) {
  if (!el || !el.tag) return null;
  const tag = el.tag;
  if (DROP_TAGS.has(tag)) return null;
  const style = el.__style || parseStyleAttribute(el.attrs?.style || "");

  // Paper Stage 4: drop subtrees that are entirely invisible unless positioned
  const isPos = style.position === "absolute" || style.position === "fixed";
  const isZeroOp = style.opacity !== undefined && parseFloat(style.opacity) === 0;
  const isVisHidden = style.visibility === "hidden";
  if (!isPos && (isZeroOp || isVisHidden)) {
    return null;
  }
  const semantic = {
    bold: ctx.semantic.bold || tag === "strong" || tag === "b",
    italic: ctx.semantic.italic || tag === "em" || tag === "i",
    underline: ctx.semantic.underline || tag === "u",
    strike: ctx.semantic.strike || tag === "s" || tag === "strike",
  };
  const font = fontFromStyle(style, ctx.font, semantic);
  const whiteSpace = typeof style["white-space"] === "string"
    ? style["white-space"]
    : tag === "pre"
      ? "pre"
      : ctx.whiteSpace;
  const info = {
    style, absolute: style.position === "absolute" || style.position === "fixed",
    isFlex: false, grid: null, imagePaintIds: [],
    margin: parseBoxEdges(style, "margin"),
    padding: parseBoxEdges(style, "padding"),
    centerX: !!el.__centerX, centerY: !!el.__centerY,
    zIndex: typeof style["z-index"] === "string" && style["z-index"] !== "auto" ? parseInt(style["z-index"], 10) : null,
    meas: conv.measurements ? conv.measurements.get(el) || null : null,
  };

  // Supplement missing styles from browser computed measurement metrics
  if (info.meas) {
    if (!style["background-color"] && info.meas.computedBackgroundColor && info.meas.computedBackgroundColor !== "rgba(0, 0, 0, 0)" && info.meas.computedBackgroundColor !== "transparent") {
      style["background-color"] = info.meas.computedBackgroundColor;
    }
    if (!style["border-width"] && !style.border && info.meas.computedBorderTopWidth && info.meas.computedBorderTopWidth !== "0px") {
      style["border-top-width"] = info.meas.computedBorderTopWidth;
      style["border-right-width"] = info.meas.computedBorderRightWidth;
      style["border-bottom-width"] = info.meas.computedBorderBottomWidth;
      style["border-left-width"] = info.meas.computedBorderLeftWidth;
      style["border-top-color"] = info.meas.computedBorderTopColor;
      style["border-right-color"] = info.meas.computedBorderRightColor;
      style["border-bottom-color"] = info.meas.computedBorderBottomColor;
      style["border-left-color"] = info.meas.computedBorderLeftColor;
      style["border-style"] = info.meas.computedBorderTopStyle || "solid";
    }
    if (!style["border-radius"] && info.meas.computedBorderTopLeftRadius && info.meas.computedBorderTopLeftRadius !== "0px") {
      style["border-top-left-radius"] = info.meas.computedBorderTopLeftRadius;
      style["border-top-right-radius"] = info.meas.computedBorderTopRightRadius;
      style["border-bottom-right-radius"] = info.meas.computedBorderBottomRightRadius;
      style["border-bottom-left-radius"] = info.meas.computedBorderBottomLeftRadius;
    }
    if (!style["box-shadow"] && info.meas.computedBoxShadow && info.meas.computedBoxShadow !== "none") {
      style["box-shadow"] = info.meas.computedBoxShadow;
    }
    if (!style["max-width"] && info.meas.computedMaxWidth && info.meas.computedMaxWidth !== "none") {
      style["max-width"] = info.meas.computedMaxWidth;
    }
    if (!style["min-width"] && info.meas.computedMinWidth && info.meas.computedMinWidth !== "auto" && info.meas.computedMinWidth !== "0px") {
      style["min-width"] = info.meas.computedMinWidth;
    }
  }
  const register = (node, nodeInfo = info, sourceEl = el) => {
    conv.byId.set(node.id, node);
    conv.all.push(node);
    conv.info.set(node.id, nodeInfo);
    if (node.hidden === undefined) node.hidden = false;
    if ("hidden" in sourceEl.attrs || nodeInfo.style.display === "none") node.hidden = true;
    if ("data-paper-locked" in sourceEl.attrs) node.locked = true;
    if (nodeInfo.absolute) {
      node.absolutePosition = true;
      conv.stats.absolute += 1;
    }
    if (nodeInfo.isFlex) conv.stats.flex += 1;
    return node;
  };
  const label = typeof el.attrs["layer-name"] === "string" ? el.attrs["layer-name"].slice(0, 200) : null;
  const registerPaintJobs = (node) => {
    for (const pid of info.imagePaintIds) {
      const paint = (node.fills || []).find((f) => f.id === pid);
      const src = paint?.image?.src;
      if (src && !src.startsWith("data:")) conv.imageJobs.push({ nodeId: node.id, paintId: pid, src });
    }
  };

  // --- replaced / special elements -------------------------------------
  if (tag === "svg") {
    const markup = serializePlain(el);
    const dims = svgDimensions(markup);
    const color = style.color ? (parseColor(style.color)?.hex || style.color) : (ctx.font.color ? ctx.font.color.hex : null);
    const fill = style.fill || el.attrs?.fill;
    const stroke = style.stroke || el.attrs?.stroke;
    const rawVb = el.attrs?.viewbox || el.attrs?.viewBox || dims.viewBox;
    const node = createNode("svg", {
      fills: [],
      borders: [],   // SVG nodes must never inherit page border styles
      svgMarkup: markup,
      svgOuterHtml: markup,
      viewBox: rawVb || undefined,
      color: color || undefined,
      fill: fill || undefined,
      stroke: stroke || undefined,
    });
    const w = px(style.width) ?? px(el.attrs?.width) ?? dims.w ?? info.meas?.w;
    const h = px(style.height) ?? px(el.attrs?.height) ?? dims.h ?? info.meas?.h;
    if (w) node.w = Math.round(w * 100) / 100;
    if (h) node.h = Math.round(h * 100) / 100;
    node.rawStyle = collectRawStyle(style, HANDLED_PROPS, tag);
    // Ensure style.borders is always empty for SVG nodes
    if (node.style) node.style.borders = [];
    conv.stats.svgs += 1;
    if (label) node.name = label;
    register(node);

    // Recursively parse individual SVG elements (paths, circles, rects, polylines, polygons, lines, groups)
    // so each element is an individual customizable canvas node!
    buildSvgChildren(el, node, conv, {
      color: color || "#18181B",
      fill: fill || undefined,
      stroke: stroke || undefined,
      viewBox: rawVb || undefined,
      strokeWidth: el.attrs?.["stroke-width"] || style["stroke-width"],
      strokeLinecap: el.attrs?.["stroke-linecap"] || style["stroke-linecap"] || "round",
      strokeLinejoin: el.attrs?.["stroke-linejoin"] || style["stroke-linejoin"] || "round",
      fillRule: el.attrs?.["fill-rule"] || style["fill-rule"] || "nonzero",
      clipRule: el.attrs?.["clip-rule"] || style["clip-rule"] || undefined,
    });

    return node;
  }
  if (tag === "img") {
    const src = el.attrs.src || "";
    if (!src) {
      const node = createNode("rect", { fills: [] });
      applyBoxStyles(node, style, info, ctx, tag);
      registerPaintJobs(node);
      if (label) node.name = label;
      return register(node);
    }
    const imgName = src ? src.split("/").pop().split("?")[0] || "image" : "image";
    const imgFill = src ? [createPaint({
      type: "image",
      kind: "image",
      image: { src, fit: "cover" },
      url: src,
      fit: "cover",
      fileName: imgName,
      name: imgName,
    })] : [];
    const node = createNode("image", { fills: imgFill, src });
    const w = px(style.width) ?? info.meas?.w ?? null;
    const h = px(style.height) ?? info.meas?.h ?? null;
    if (w !== null) node.w = Math.round(w * 100) / 100;
    if (h !== null) node.h = Math.round(h * 100) / 100;
    node.rawStyle = collectRawStyle(style, HANDLED_PROPS, tag);
    if (!src.startsWith("data:")) conv.imageJobs.push({ nodeId: node.id, paintId: null, src });
    conv.stats.images += 1;
    if (label) node.name = label;
    return register(node);
  }
  if (tag === "video") {
    const node = createNode("frame", {
      fills: [createPaint({ type: "solid", color: "#111111" })],
    });
    node.videoPlaceholder = true;
    applyBoxStyles(node, style, info, ctx, tag);
    if (node.fills.length === 0) node.fills = [createPaint({ type: "solid", color: "#111111" })];
    node.name = label || "Video";
    conv.stats.videos += 1;
    return register(node);
  }
  if (tag === "canvas") {
    const node = createNode("rect", { fills: [createPaint({ type: "solid", color: "#E5E5E5" })] });
    node.canvasPlaceholder = true;
    applyBoxStyles(node, style, info, ctx, tag);
    if (node.fills.length === 0) node.fills = [createPaint({ type: "solid", color: "#E5E5E5" })];
    registerPaintJobs(node);
    node.name = label || "Canvas";
    return register(node);
  }

  // --- text collapse (Stage D) ------------------------------------------
  if (isTextCollapsible(el, style)) {
    const { text, html: richHtml } = collectRichText(el, font, whiteSpace);
    if (text) {
      const node = makeTextNode(text, font, style, el, { semantic }, { meas: info.meas, html: richHtml });
      conv.stats.texts += 1;
      if (label) node.name = label;
      return register(node);
    }
  }

  // --- container or leaf -------------------------------------------------
  const elementChildren = (el.children || []).filter((c) => typeof c.text !== "string" && !DROP_TAGS.has(c.tag));
  const hasText = (el.children || []).some((c) => typeof c.text === "string" && c.text.trim());
  const display = (style.display || info.meas?.computedDisplay || "").trim().toLowerCase();
  const isFlex = display === "flex" || display === "inline-flex";
  const isGrid = display === "grid" || display === "inline-grid";
  const type = (tag === "rect" || tag === "rectangle") ? "rect" : "frame";
  const node = createNode(type, { fills: [] });
  applyBoxStyles(node, style, info, ctx, tag);
  registerPaintJobs(node);
  if (label) node.name = label;
  else if (FORM_LABELS[tag]) node.name = FORM_LABELS[tag];
  register(node);
  if (type === "frame") conv.stats.frames += 1;
  else conv.stats.rects += 1;
  if (info.grid) conv.stats.grids += 1;

  // Calculate inner content width and height for child context propagation
  const padH = (info.padding?.left || 0) + (info.padding?.right || 0);
  const borderH = (node.borders || [])
    .filter((b) => b && (b.side === "all" || b.side === "left" || b.side === "right"))
    .reduce((sum, b) => sum + (b.width || 0), 0);
  const contentW = typeof node.w === "number" ? Math.max(0, node.w - padH - borderH) : null;
  const padV = (info.padding?.top || 0) + (info.padding?.bottom || 0);
  const borderV = (node.borders || [])
    .filter((b) => b && (b.side === "all" || b.side === "top" || b.side === "bottom"))
    .reduce((sum, b) => sum + (b.width || 0), 0);
  const contentH = typeof node.h === "number" ? Math.max(0, node.h - padV - borderV) : null;

  // Children: this element's own containing-block bucket collects its
  // absolute descendants when it is one; otherwise they bubble up.
  const ownBucket = isContainingBlock(style) || ctx.forceCB ? [] : null;
  const childCtx = {
    font, whiteSpace, semantic,
    absBucket: ownBucket || ctx.absBucket,
    parentTag: tag,
    parentDisplay: style.display || (BLOCK_TAGS.has(tag) ? "block" : "inline"),
    parentFlexDir: node.flex ? node.flex.direction : null,
    parentAlignItems: style["align-items"] || "stretch",
    parentJustifyItems: style["justify-items"] || "stretch",
    parentContentW: contentW ?? ctx?.parentContentW ?? null,
    parentContentH: contentH ?? ctx?.parentContentH ?? null,
    parentGridCols: info.grid ? gridColumnWidths(info.grid.templateColumns, contentW || 100, info.grid.colGap) : null,
  };
  const appendChild = (childNode) => {
    const childInfo = conv.info.get(childNode.id);
    if (childInfo && childInfo.absolute) {
      childCtx.absBucket.push(childNode);
    } else {
      childNode.parentId = node.id;
      node.childIds.push(childNode.id);
    }
  };
  for (const child of el.children || []) {
    if (typeof child.text === "string") {
      const text = collapseWhitespace(child.text, whiteSpace).trim();
      if (!text) continue;
      const tn = makeTextNode(text, font, style, el, { semantic }, { size: false });
      // A raw text child carries its parent's font but NONE of its box
      // info — it is in-flow, marginless, and never a layout container.
      register(tn, {
        style, absolute: false, isFlex: false, grid: null, imagePaintIds: [],
        margin: parseBoxEdges({}, "margin"), padding: parseBoxEdges({}, "padding"),
        centerX: false, centerY: false, zIndex: null, meas: null,
      });
      conv.stats.texts += 1;
      tn.parentId = node.id;
      node.childIds.push(tn.id);
      continue;
    }
    if (child.tag === "br" || child.tag === "wbr") continue; // breaks only matter inside collapsed text
    const childNode = buildElement(child, childCtx, conv);
    if (childNode) appendChild(childNode);
  }
  if (ownBucket) {
    for (const absNode of ownBucket) {
      absNode.parentId = node.id;
      node.childIds.push(absNode.id);
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// Positioning pass — this app's nodes carry absolute x/y, so in-flow
// block/grid children are placed by a small layout pass (flex children
// are the flex engine's job; their x/y stay 0). Absolute children were
// already re-parented to their containing block during the walk.
// ---------------------------------------------------------------------------

function nodeHeight(node, availW, conv) {
  if (node.type === "text" && node.hMode === "Fit") {
    const fs = node.text?.fontSize || 16;
    const lh = typeof node.text?.lineHeight === "number" ? node.text.lineHeight : 1.25;
    const content = typeof node.text === "string" ? node.text : (node.text?.content || node.name || "");
    return estimateMeasureText(content, fs, lh).h;
  }
  // For freeform containers with Fit height and no measurement, use their
  // resolved child bounds (bottom-up pass sets node._resolvedH for this).
  if (node._resolvedH != null) return node._resolvedH;
  return node.h;
}

/**
 * Bottom-up height resolution for Fit-height freeform containers.
 *
 * Problem: Chrome computed-style dumps give section-level elements `height: auto`.
 * The importer maps this to `hMode: "Fit"` with a default `h: 100`. Because each
 * section only gets ONE pass through positionChildren, the cursor advances by 100px
 * per section instead of the actual rendered height, causing all sections to stack
 * in a 400–500px band at the top of a 7000px+ page.
 *
 * Fix: After positionTree() places all in-flow children inside each parent, walk
 * the tree bottom-up and for every freeform (non-flex, non-grid) Fit-height frame,
 * recompute its height from the bottommost child boundary + its own padding.
 * Store the result as `node._resolvedH` (a transient property consumed only during
 * positionTree and the cursor-advancement step; never serialised into the document).
 *
 * Absolutely positioned children do NOT contribute to normal-flow height (matching
 * CSS behaviour where `position: absolute` takes elements out of flow).
 */
function resolveContainerHeights(node, conv) {
  if (!node || !node.childIds || node.childIds.length === 0) return;

  // Recurse depth-first so inner containers resolve before their parents read them.
  for (const cid of node.childIds) {
    const child = conv.byId.get(cid);
    if (child) resolveContainerHeights(child, conv);
  }

  // Only apply to freeform (not flex, not grid) frames whose height is Fit or Auto.
  const info = conv.info.get(node.id);
  if (!info) return;
  if (node.flex || info.isFlex || info.isGrid) return; // flex/grid engine owns their height
  if (node.hMode !== "Fit" && node.hMode !== "Auto") return;
  // If a measurement was already captured (browser-measured), trust it; don't override.
  if (info.meas && typeof info.meas.h === "number" && info.meas.h > 0) return;

  const padB = info.padding?.bottom || 0;
  let maxBottom = 0;
  let hasInFlowChild = false;

  for (const cid of node.childIds) {
    const child = conv.byId.get(cid);
    if (!child) continue;
    const childInfo = conv.info.get(child.id);
    // Absolutely positioned children are out of flow — do not contribute to Fit height.
    if (childInfo?.absolute || child.absolutePosition) continue;
    hasInFlowChild = true;

    const cy = typeof child.y === "number" ? child.y : 0;
    // Use _resolvedH if available (from recursive resolution just above),
    // otherwise fall back to node.h.
    const ch = child._resolvedH != null ? child._resolvedH : (typeof child.h === "number" ? child.h : 0);
    maxBottom = Math.max(maxBottom, cy + ch);
  }

  if (hasInFlowChild && maxBottom > 0) {
    const resolved = Math.round((maxBottom + padB) * 100) / 100;
    // Only update if the resolved height is meaningfully larger than the current placeholder.
    if (resolved > (node.h || 0)) {
      node._resolvedH = resolved;
      // Also update node.h so subsequent positioning passes (cursor advancement)
      // use the corrected height immediately.
      node.h = resolved;
      if (node.size?.h) node.size.h = { kind: "fit", px: resolved };
    }
  }
}

function getParentPadding(parent, conv, side) {
  if (!parent) return 0;
  const pi = conv?.info?.get(parent.id);
  if (pi?.padding?.[side] != null) return pi.padding[side] || 0;
  if (parent.flex?.padding?.[side]?.value != null) return parent.flex.padding[side].value || 0;
  return 0;
}

function positionAbsolute(node, parent, info, conv) {
  const style = info.style;
  const left = px(style.left);
  const right = px(style.right);
  const top = px(style.top);
  const bottom = px(style.bottom);

  // If both left and right are specified, stretch the element between them
  if (parent && left !== null && right !== null) {
    const parentPadL = getParentPadding(parent, conv, "left");
    const parentPadR = getParentPadding(parent, conv, "right");
    const availW = Math.max(0, parent.w - parentPadL - parentPadR);
    const stretchedW = Math.max(0, availW - left - right);
    if (stretchedW > 0) {
      node.w = Math.round(stretchedW * 100) / 100;
      node.wMode = "Fixed";
    }
  }

  // If both top and bottom are specified, stretch the element between them
  if (parent && top !== null && bottom !== null) {
    const parentPadT = getParentPadding(parent, conv, "top");
    const parentPadB = getParentPadding(parent, conv, "bottom");
    const availH = Math.max(0, parent.h - parentPadT - parentPadB);
    const stretchedH = Math.max(0, availH - top - bottom);
    if (stretchedH > 0) {
      node.h = Math.round(stretchedH * 100) / 100;
      node.hMode = "Fixed";
    }
  }

  if (info.centerX && parent) node.x = Math.round(((parent.w - node.w) / 2 + (left ?? 0) - (right ?? 0)) * 100) / 100;
  else if (left !== null) node.x = left;
  else if (right !== null && parent) node.x = Math.round((parent.w - right - node.w) * 100) / 100;
  if (info.centerY && parent) node.y = Math.round(((parent.h - node.h) / 2 + (top ?? 0) - (bottom ?? 0)) * 100) / 100;
  else if (top !== null) node.y = top;
  else if (bottom !== null && parent) node.y = Math.round((parent.h - bottom - node.h) * 100) / 100;
}

function gridColumnWidths(template, contentW, colGap) {
  if (!template || typeof template !== "string") return null;
  const rep = /repeat\(\s*(\d+)\s*,/.exec(template);
  if (rep) {
    const n = parseInt(rep[1], 10);
    if (n > 0) return Array.from({ length: n }, () => (contentW - colGap * (n - 1)) / n);
  }
  const tracks = splitTopLevel(template, " ").map((t) => t.trim()).filter(Boolean);
  if (!tracks.length) return null;
  const widths = tracks.map((t) => px(t));
  const frs = tracks.map((t) => {
    const m = /^(\d+(?:\.\d+)?)fr$/.exec(t);
    return m ? parseFloat(m[1]) : 0;
  });
  const fixedTotal = widths.reduce((a, b) => a + (b || 0), 0);
  const frTotal = frs.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, contentW - fixedTotal - colGap * (tracks.length - 1));
  return tracks.map((t, i) => (widths[i] !== null ? widths[i] : frTotal ? (remaining * frs[i]) / frTotal : 0));
}

function positionChildren(node, conv) {
  const info = conv.info.get(node.id);
  if (!info) return;
  const kids = node.childIds.map((id) => conv.byId.get(id)).filter(Boolean);
  if (!kids.length) return;
  const padL = info.padding.left || 0;
  const padT = info.padding.top || 0;
  const padR = info.padding.right || 0;
  const contentW = Math.max(0, node.w - padL - padR);

  // 1. Flex layout: in-flow children belong strictly to the flex engine.
  // Their x and y must be 0, never holding stale fractional measurement offsets.
  if (node.flex) {
    for (const kid of kids) {
      const ki = conv.info.get(kid.id);
      if (ki && ki.absolute) {
        positionAbsolute(kid, node, ki, conv);
      } else {
        kid.x = 0;
        kid.y = 0;
        kid.absolutePosition = false;
      }
    }
    return;
  }

  // 2. CSS Grid layout: in-flow children belong strictly to the grid engine.
  if (info.grid) {
    const cols = gridColumnWidths(info.grid.templateColumns, contentW, info.grid.colGap) || [contentW];
    let col = 0;
    let rowY = padT;
    let rowH = 0;
    let colX = padL;
    for (const kid of kids) {
      const ki = conv.info.get(kid.id);
      if (ki && ki.absolute) {
        positionAbsolute(kid, node, ki, conv);
        continue;
      } else {
        kid.absolutePosition = false;
      }
      if (col >= cols.length) {
        col = 0;
        colX = padL;
        rowY += rowH + info.grid.rowGap;
        rowH = 0;
      }
      kid.x = Math.round(colX * 100) / 100;
      kid.y = Math.round(rowY * 100) / 100;
      if (cols[col] > 0 && (kid.wMode === "Fill" || !ki?.meas || kid.w === 100)) {
        kid.w = Math.round(cols[col] * 100) / 100;
        if (kid.size?.w) {
          kid.size.w = { kind: kid.wMode === "Fill" ? "fill" : "fixed", px: kid.w };
        }
      }
      rowH = Math.max(rowH, nodeHeight(kid, cols[col]));
      colX += cols[col] + info.grid.colGap;
      col += 1;
    }
    return;
  }

  // 3. Block flow / Normal document flow:
  // For absolutely positioned children, use positionAbsolute.
  // For in-flow children, place inside the parent's content box without double-counting
  // parent borders or subpixel zoom jitter (which produced arbitrary offsets like 2.72px).
  const placed = new Set();
  const parentBorderL = info.border?.left || 0;
  const parentBorderT = info.border?.top || 0;

  if (info.meas) {
    for (const kid of kids) {
      const ki = conv.info.get(kid.id);
      if (!ki || !ki.meas) continue;
      if (ki.absolute) {
        positionAbsolute(kid, node, ki, conv);
        placed.add(kid.id);
        continue;
      }
      // In-flow child: subtract parent border to get inner coordinate
      let relX = (ki.meas.x - info.meas.x) - parentBorderL;
      const kw = typeof kid.w === "number" ? kid.w : 100;
      const isFullWidthFill = kid.wMode === "Fill" && Math.abs(kw - contentW) <= 4;
      if (ki.margin?.auto?.left && ki.margin?.auto?.right && contentW > kw) {
        // Auto margins: horizontally center the element within parent content width
        relX = Math.round((padL + (contentW - kw) / 2) * 100) / 100;
      } else if (isFullWidthFill || Math.abs(relX) < 3.5) {
        relX = 0;
      } else if (Math.abs(relX - padL) < 3.5) {
        relX = padL;
      }
      let relY = (ki.meas.y - info.meas.y) - parentBorderT;
      if (Math.abs(relY) < 3.5 || Math.abs(relY - padT) < 3.5) {
        relY = padT;
      }
      kid.x = Math.round(relX * 100) / 100;
      kid.y = Math.round(relY * 100) / 100;
      kid.absolutePosition = false;
      placed.add(kid.id);
    }
  }

  // Block flow stack fallback for unmeasured children
  let cursor = padT;
  for (const kid of kids) {
    if (placed.has(kid.id)) {
      // Measured children still advance the stack for unmeasured ones.
      cursor = Math.max(cursor, kid.y + nodeHeight(kid, contentW));
      continue;
    }
    const ki = conv.info.get(kid.id);
    if (!ki) continue;
    if (ki.absolute) {
      positionAbsolute(kid, node, ki, conv);
      continue;
    }
    const m = ki.margin;
    const kw = kid.wMode === "Relative" ? (kid.w / 100) * contentW : kid.w;
    if (m.auto.left && m.auto.right && contentW > kw) {
      kid.x = Math.round((padL + (contentW - kw) / 2) * 100) / 100;
    } else if (kid.wMode === "Fill" && Math.abs(kw - contentW) <= 4) {
      kid.x = 0;
    } else {
      kid.x = Math.round((padL + (m.left || 0)) * 100) / 100;
    }
    kid.y = Math.round((cursor + (m.top || 0)) * 100) / 100;
    cursor = kid.y + nodeHeight(kid, contentW) + (m.bottom || 0);
    kid.absolutePosition = false;
  }
}

function positionTree(node, conv) {
  positionChildren(node, conv);
  for (const cid of node.childIds) {
    const child = conv.byId.get(cid);
    if (child) positionTree(child, conv);
  }
}

// ---------------------------------------------------------------------------
// Post-passes (verified Stage G order, adapted): z-index → sibling
// order; flex gap recovery from uniform child margins.
// ---------------------------------------------------------------------------

function applyZOrder(list, conv) {
  if (!list || list.length < 2) return list;
  const withZ = list.map((id) => conv.byId.get(id)).filter(Boolean);
  if (!withZ.some((n) => conv.info.get(n.id)?.zIndex !== null && conv.info.get(n.id)?.zIndex !== undefined)) {
    return list;
  }
  const decorated = withZ.map((node, i) => ({ node, i, z: conv.info.get(node.id)?.zIndex ?? 0 }));
  decorated.sort((a, b) => a.z - b.z || a.i - b.i);
  return decorated.map((d) => d.node.id);
}

function recoverFlexGap(node, conv) {
  if (!node.flex || node.flex.gap.value) return;
  const kids = node.childIds
    .map((id) => conv.byId.get(id))
    .filter((k) => k && !k.absolutePosition);
  if (kids.length < 2) return;
  const column = node.flex.direction === "column";
  const lead = column ? "top" : "left";
  const trail = column ? "bottom" : "right";
  const marginsOf = (list, side) => list.map((k) => conv.info.get(k.id)?.margin[side] || 0);
  const uniform = (vals) => (vals.length && vals.every((v) => v === vals[0]) && vals[0] > 0 ? vals[0] : null);
  const fromLead = uniform(marginsOf(kids.slice(1), lead));
  const gap = fromLead ?? uniform(marginsOf(kids.slice(0, -1), trail));
  if (!gap) return;
  if (node.flex.wrap) {
    // Wrap containers fold the recovered gap into main-start padding.
    const side = column ? "top" : "left";
    node.flex.padding[side] = { value: (node.flex.padding[side]?.value || 0) + gap, tokenId: null };
  } else {
    node.flex.gap = { value: gap, tokenId: null };
  }

  // Once the uniform margin is recovered as container gap,
  // delete it from the children so they don't get double spacing (gap + margin)!
  if (fromLead) {
    const rawProp = column ? "margin-top" : "margin-left";
    for (const k of kids.slice(1)) {
      const kInfo = conv.info.get(k.id);
      if (kInfo) kInfo.margin[lead] = 0;
      if (k.rawStyle) delete k.rawStyle[rawProp];
      if (k.style?.customCss) delete k.style.customCss[rawProp];
    }
  } else if (gap) {
    const rawProp = column ? "margin-bottom" : "margin-right";
    for (const k of kids.slice(0, -1)) {
      const kInfo = conv.info.get(k.id);
      if (kInfo) kInfo.margin[trail] = 0;
      if (k.rawStyle) delete k.rawStyle[rawProp];
      if (k.style?.customCss) delete k.style.customCss[rawProp];
    }
  }
}

// ---------------------------------------------------------------------------
// Top-level conversion
// ---------------------------------------------------------------------------

/**
 * Convert plain-tree roots into model nodes.
 * Returns { roots, all, byId, stats, imageJobs } — nodes are NOT yet in
 * a doc; the caller inserts the root subtrees in one store commit.
 */
export function convertPlainTree(plainRoots, opts = {}) {
  const rootsIn = (plainRoots || []).filter((r) => r && !DROP_TAGS.has(r.tag));
  const stats = {
    elements: countElements(plainRoots || []),
    frames: 0, rects: 0, texts: 0, images: 0, svgs: 0, videos: 0,
    flex: 0, grids: 0, absolute: 0,
  };
  applyDocumentFixups(plainRoots || []);
  const conv = {
    byId: new Map(), all: [], info: new Map(), imageJobs: [], stats,
    measurements: opts.measurements || null,
    exactLayout: Boolean(opts.exactLayout),
  };
  const rootBucket = [];
  const baseCtx = {
    font: { ...DEFAULT_FONT }, whiteSpace: "", semantic: { bold: false, italic: false, underline: false, strike: false },
    absBucket: rootBucket,
    parentTag: null,
    parentDisplay: null,
    parentFlexDir: null,
    parentAlignItems: null,
    parentJustifyItems: null,
    parentContentW: null,
    parentContentH: null,
    parentGridCols: null,
  };
  const roots = [];
  rootsIn.forEach((el, idx) => {
    const ctx = idx === 0 && rootsIn.length === 1 ? { ...baseCtx, forceCB: true } : baseCtx;
    const node = buildElement(el, ctx, conv);
    if (!node) return;
    const info = conv.info.get(node.id);
    if (info && info.absolute) rootBucket.push(node);
    else roots.push(node);
  });
  for (const absNode of rootBucket) roots.push(absNode);

  // Position roots: a lone root sits at the origin; multiple roots
  // stack like a block column (absolute roots keep their offsets).
  // Measured roots keep their measured spot (the glue normalises
  // measurements so the outermost root measures at 0,0).
  let cursor = 0;
  for (const root of roots) {
    const info = conv.info.get(root.id);
    if (info && info.absolute) positionAbsolute(root, null, info, conv);
    else if (info && info.meas) {
      root.x = Math.round(info.meas.x * 100) / 100;
      root.y = Math.round(info.meas.y * 100) / 100;
      cursor = Math.max(cursor, root.y + nodeHeight(root, root.w));
    } else {
      root.x = 0;
      root.y = cursor;
      cursor += nodeHeight(root, root.w);
    }
    root.parentId = null;
  }
  conv.roots = roots;
  for (const root of roots) positionTree(root, conv);

  // Phase 5: Bottom-up Fit-height resolution.
  // After positionTree places children, freeform Fit-height containers that had no
  // browser-measured height (default h: 100) now get their height from their
  // children's actual bottom boundary. This prevents the vertical compression
  // symptom where all sections collapse into a 400px band.
  for (const root of roots) resolveContainerHeights(root, conv);

  // Re-run positionTree after heights are resolved so that block-flow cursors
  // use the corrected heights when stacking subsequent siblings.
  for (const root of roots) positionTree(root, conv);

  // Expand root frames so that the main frame shows all imported content without scrollbars
  for (const root of roots) {
    if (!root.childIds || root.childIds.length === 0) continue;
    let maxBottom = 0;
    let maxRight = 0;
    const rootPadB = conv.info.get(root.id)?.padding?.bottom || 0;
    const rootPadR = conv.info.get(root.id)?.padding?.right || 0;

    for (const cid of root.childIds) {
      const child = conv.byId.get(cid);
      if (!child) continue;
      const ch = typeof child.h === "number" ? child.h : (child.size?.h?.px || 0);
      const cw = typeof child.w === "number" ? child.w : (child.size?.w?.px || 0);
      const cy = typeof child.y === "number" ? child.y : (child.position?.y || 0);
      const cx = typeof child.x === "number" ? child.x : (child.position?.x || 0);
      maxBottom = Math.max(maxBottom, cy + ch);
      maxRight = Math.max(maxRight, cx + cw);
    }

    if (maxBottom > 0) {
      const totalH = Math.round((maxBottom + rootPadB) * 100) / 100;
      if (typeof root.h !== "number" || root.h < totalH) {
        root.h = totalH;
      }
    }
    if (maxRight > 0) {
      const totalW = Math.round((maxRight + rootPadR) * 100) / 100;
      if (typeof root.w !== "number" || root.w < totalW) {
        root.w = totalW;
      }
    }
  }

  // Post-passes: gap recovery (needs margins), then z-index ordering.
  for (const node of conv.all) recoverFlexGap(node, conv);
  for (const node of conv.all) node.childIds = applyZOrder(node.childIds, conv);
  const orderedRoots = applyZOrder(roots.map((r) => r.id), conv).map((id) => conv.byId.get(id)).filter(Boolean);

  return { roots: orderedRoots, all: conv.all, byId: conv.byId, stats, imageJobs: conv.imageJobs };
}

/** HTML string → conversion result (parse + convert). */
export function convertHtml(html, opts = {}) {
  return convertPlainTree(parseHtmlFragment(html), opts);
}

/**
 * Resolve converted image jobs through an injected async resolver
 * (src) → dataURL string | null. Successes are written into the nodes
 * (node.src for image nodes, paint.image.src for background paints);
 * failures strip the source and leave a neutral placeholder fill on
 * image nodes. Returns { applied, failed } — the caller groups all
 * failures into ONE "Failed to load N images" toast.
 */
export async function resolveImportedImages(result, resolver) {
  let applied = 0;
  let failed = 0;
  for (const job of result.imageJobs) {
    const node = result.byId.get(job.nodeId);
    if (!node) continue;
    let data = null;
    try {
      data = await resolver(job.src);
    } catch {
      data = null;
    }
    if (data) {
      applied += 1;
      if (job.paintId) {
        const paint = (node.fills || []).find((f) => f.id === job.paintId);
        if (paint && paint.image) paint.image.src = data;
      } else {
        node.src = data;
      }
    } else {
      failed += 1;
      if (job.paintId) {
        node.fills = (node.fills || []).filter((f) => f.id !== job.paintId);
      } else {
        node.src = null;
        if (!node.fills || node.fills.length === 0) {
          node.fills = [createPaint({ type: "solid", color: "#E5E5E5" })];
        }
      }
    }
  }
  return { applied, failed };
}

/**
 * Format a pure converter node to fit Canvas Tool's document model schema:
 * position, size, layout (flex/freeform), style (fills, borders, radius, shadows, blendMode, opacity),
 * clipContent, rotation, text, image, and svg.
 */
export function formatNodeForCanvasTool(node) {
  let posX = typeof node.x === "number" ? Math.round(node.x * 100) / 100 : 0;
  let posY = typeof node.y === "number" ? Math.round(node.y * 100) / 100 : 0;
  if (!node.absolutePosition) {
    if (Math.abs(posX) < 0.05) posX = 0;
  }
  const widthPx = typeof node.w === "number" ? Math.max(1, Math.round(node.w * 100) / 100) : 100;
  const heightPx = typeof node.h === "number" ? Math.max(1, Math.round(node.h * 100) / 100) : 100;

  node.position = {
    x: posX,
    y: posY,
    ...(node.absolutePosition ? { absolute: true } : { absolute: false }),
  };

  const wKind = node.wMode === "Fit" ? "fit" : (node.wMode === "Fill" ? "fill" : (node.wMode === "Auto" ? "auto" : (node.wMode === "Relative" ? "relative" : "fixed")));
  const hKind = node.hMode === "Fit" ? "fit" : (node.hMode === "Fill" ? "fill" : (node.hMode === "Auto" ? "auto" : (node.hMode === "Relative" ? "relative" : "fixed")));
  node.size = {
    w: { kind: wKind, px: widthPx, ...(node.wMode === "Relative" ? { pct: node.w } : {}) },
    h: { kind: hKind, px: heightPx, ...(node.hMode === "Relative" ? { pct: node.h } : {}) },
  };

  if (node.flex) {
    const padTop = node.flex.padding?.top?.value ?? 0;
    const padRight = node.flex.padding?.right?.value ?? 0;
    const padBottom = node.flex.padding?.bottom?.value ?? 0;
    const padLeft = node.flex.padding?.left?.value ?? 0;
    node.layout = {
      mode: "flex",
      direction: node.flex.direction || "row",
      reverse: Boolean(node.flex.reverse),
      wrap: Boolean(node.flex.wrap),
      gap: node.flex.gap?.value ?? (typeof node.flex.gap === "number" ? node.flex.gap : 0),
      alignMain: node.flex.alignMain || "start",
      alignCross: node.flex.alignCross || "start",
      padding: {
        t: padTop,
        r: padRight,
        b: padBottom,
        l: padLeft,
        h: padLeft === padRight ? padLeft : padLeft,
        v: padTop === padBottom ? padTop : padTop,
      },
    };
  } else if (node.grid) {
    node.layout = {
      ...node.grid,
      mode: "grid",
    };
  } else {
    node.layout = { mode: "freeform" };
  }

  const pad = (node.padding ? { top: node.padding.t, right: node.padding.r, bottom: node.padding.b, left: node.padding.l } : parseBoxEdges(node.rawStyle || {}, "padding"));
  if (pad.top || pad.right || pad.bottom || pad.left) {
    const padObj = {
      t: pad.top || 0,
      r: pad.right || 0,
      b: pad.bottom || 0,
      l: pad.left || 0,
      h: pad.left || 0,
      v: pad.top || 0,
    };
    node.padding = padObj;
    if (node.layout) node.layout.padding = padObj;
  }
  const mar = (node.margin ? { top: node.margin.t, right: node.margin.r, bottom: node.margin.b, left: node.margin.l, auto: node.margin.auto } : parseBoxEdges(node.rawStyle || {}, "margin"));
  if (mar.top || mar.right || mar.bottom || mar.left || mar.auto?.left || mar.auto?.right || node.centerX) {
    const isAutoH = Boolean(mar.auto?.left && mar.auto?.right) || Boolean(node.centerX);
    const marObj = {
      t: mar.top || 0,
      r: isAutoH ? "auto" : (mar.right || 0),
      b: mar.bottom || 0,
      l: isAutoH ? "auto" : (mar.left || 0),
      h: isAutoH ? "auto" : (mar.left || 0),
      v: mar.top || 0,
      autoH: isAutoH,
    };
    node.margin = marObj;
    if (node.layout) node.layout.margin = marObj;
  }

  // Format fills for CanvasNode / Inspector
  const fills = (node.fills || []).map((f) => {
    if (f.type === "gradient" || f.kind === "gradient") {
      const g = f.gradient || f;
      return {
        kind: "gradient",
        gradientType: g.kind === "radial" ? "radial" : "linear",
        angle: g.angle ?? 180,
        stops: (g.stops || []).map((s) => ({
          color: s.color,
          alpha: s.opacity != null ? (s.opacity > 1 ? s.opacity / 100 : s.opacity) : (s.alpha ?? 1),
          at: s.at ?? 0,
        })),
        css: f.css || g.css || undefined,
      };
    }
    if (f.type === "image" || f.kind === "image") {
      const rawFit = mapObjectFit(f.image?.fit || f.fit || node.rawStyle?.["object-fit"]);
      return {
        kind: "image",
        url: f.image?.src || f.url || "",
        fit: rawFit || (f.image?.fit || f.fit || "fill"),
      };
    }
    return {
      kind: "solid",
      color: f.color || "#000000",
      alpha: f.opacity != null ? (f.opacity > 1 ? f.opacity / 100 : f.opacity) : (f.alpha ?? 1),
    };
  });

  // Format borders
  const borders = [];
  if (Array.isArray(node.borders)) {
    for (const b of node.borders) {
      if (b && b.width > 0) {
        const hex = b.color?.hex || b.color || "#000000";
        const op = b.color?.opacity ?? b.opacity ?? 100;
        borders.push({
          side: (b.side || "all").toLowerCase(),
          width: b.width,
          style: b.style || "solid",
          color: hex,
          opacity: op,
          alpha: op > 1 ? op / 100 : op,
          paint: b.paint || { kind: "solid", color: hex, alpha: op > 1 ? op / 100 : op },
        });
      }
    }
    if (borders.length === 4) {
      const first = borders[0];
      const allSame = borders.every(
        (b) => b.width === first.width && b.style === first.style && b.paint?.color === first.paint?.color && b.paint?.alpha === first.paint?.alpha
      );
      if (allSame) {
        borders.splice(0, 4, {
          side: "all",
          width: first.width,
          style: first.style,
          color: first.color,
          opacity: first.opacity,
          alpha: first.alpha,
          paint: first.paint,
        });
      }
    }
  }

  // Format radius
  let radius = 0;
  if (node.radius) {
    if (typeof node.radius === "number") {
      radius = Math.min(9999, Math.max(0, node.radius));
    } else if (Array.isArray(node.radius.corners)) {
      const [tl, tr, br, bl] = node.radius.corners;
      radius = {
        tl: Math.min(9999, Math.max(0, tl || 0)),
        tr: Math.min(9999, Math.max(0, tr || 0)),
        br: Math.min(9999, Math.max(0, br || 0)),
        bl: Math.min(9999, Math.max(0, bl || 0)),
      };
    } else if (typeof node.radius.value === "number") {
      radius = Math.min(9999, Math.max(0, node.radius.value));
    }
  }

  const customCss = {};
  if (node.rawStyle && typeof node.rawStyle === "object") {
    for (const [k, v] of Object.entries(node.rawStyle)) {
      if (v != null && String(v).trim() !== "" && !isIgnoredOtherStyle(k, v)) {
        customCss[k] = { value: String(v).trim(), enabled: true };
      }
    }
    // Also prune ignored props from node.rawStyle so it stays completely clean
    for (const k of Object.keys(node.rawStyle)) {
      if (isIgnoredOtherStyle(k, node.rawStyle[k])) {
        delete node.rawStyle[k];
      }
    }
    if (Object.keys(node.rawStyle).length === 0) {
      delete node.rawStyle;
    }
  }

  const formatShadowList = (list) => (list || []).map((s) => {
    const op = s.opacity ?? 100;
    const alpha = s.alpha ?? (op > 1 ? op / 100 : op);
    return {
      x: s.x ?? 0,
      y: s.y ?? 0,
      blur: s.blur ?? 0,
      spread: s.spread ?? 0,
      color: s.color || "#000000",
      opacity: op,
      alpha,
    };
  });
  const formattedShadows = formatShadowList(node.shadows);
  const formattedInnerShadows = formatShadowList(node.innerShadows);

  node.style = {
    fills,
    fill: fills[0] || null,
    borders,
    border: borders[0] || null,
    radius,
    shadow: formattedShadows,
    shadows: formattedShadows,
    innerShadow: formattedInnerShadows,
    innerShadows: formattedInnerShadows,
    blendMode: node.blendMode || "normal",
    opacity: node.opacity != null ? (node.opacity > 1 ? node.opacity / 100 : node.opacity) : 1,
    overflow: node.clipContent ? "hidden" : "visible",
    ...(Object.keys(customCss).length ? { customCss } : {}),
  };

  node.clipContent = Boolean(node.clipContent);
  node.rotation = node.rotation ?? 0;

  if (node.type === "text" && node.text) {
    const rawContent = node.text.content || "";
    const isItalic = node.text.fontStyle === "Italic" || Boolean(node.text.italic);
    const fs = node.text.fontSize || 16;
    const lh = normalizeLineHeight(node.text.lineHeight, fs);
    const rawWs = (node.rawStyle?.["white-space"] || node.text.whiteSpace || "").toLowerCase();
    const explicitNowrap = rawWs === "nowrap" || rawWs === "pre";
    node.text = {
      content: rawContent,
      fontFamily: node.text.fontFamily || "Inter",
      fontWeight: node.text.fontWeight || 400,
      fontSize: fs,
      lineHeight: lh,
      letterSpacing: node.text.letterSpacing || 0,
      align: node.text.alignX || node.text.align || "left",
      underline: Boolean(node.text.underline),
      case: node.text.textTransform === "uppercase" ? "upper" : (node.text.textTransform === "lowercase" ? "lower" : "none"),
      fontStyle: isItalic ? "Italic" : (node.text.fontStyle || "Regular"),
      italic: isItalic,
      truncation: Boolean(node.text.truncation) || node.rawStyle?.["text-overflow"] === "ellipsis" || undefined,
      wrap: explicitNowrap ? "none" : (node.text.wrap || "wrap"),
      ...(node.text.html ? { html: node.text.html } : {}),
    };
    if (node.h > fs * 2.5 && !rawContent.includes("\n")) {
      node.h = Math.round(fs * lh);
      if (node.size?.h) {
        node.size.h = { kind: "fit" };
      }
    }
    if (fills.length && fills[0].color) {
      node.style.color = fills[0].color;
    }
  }

  if (node.type === "path" || node.type === "polygon") {
    if (!node.style) node.style = {};
    if (node.fill && node.fill !== "none") {
      const fillObj = { kind: "solid", color: node.fill };
      node.style.fill = fillObj;
      node.style.fills = [fillObj];
    } else {
      node.style.fill = null;
      node.style.fills = [];
    }
    if (node.stroke && node.stroke !== "none") {
      node.style.stroke = {
        width: node.strokeWidth || 1.3,
        paint: { kind: "solid", color: node.stroke, alpha: 1 },
      };
    } else {
      node.style.stroke = null;
    }
  }

  if (node.type === "group") {
    if (!node.style) node.style = {};
    if (node.fill && node.fill !== "none") {
      node.style.fill = { kind: "solid", color: node.fill };
    }
    if (node.stroke && node.stroke !== "none") {
      node.style.stroke = {
        width: node.strokeWidth || 1.3,
        paint: { kind: "solid", color: node.stroke, alpha: 1 },
      };
    }
  }

  if (node.type === "svg") {
    if (!node.svgMarkup && node.rawSvg) node.svgMarkup = node.rawSvg;
    if (node.svgMarkup && !node.svgOuterHtml) node.svgOuterHtml = node.svgMarkup;
    if (node.color) {
      if (!node.style) node.style = {};
      node.style.color = node.color;
    }
  }

  if (node.type === "image" && node.src) {
    const rawFit = mapObjectFit(node.rawStyle?.["object-fit"] || node.image?.fit);
    const fit = rawFit || "cover";
    node.image = { url: node.src, fit };
    if (!node.style) node.style = {};
    if (!node.style.fills || !node.style.fills.some((f) => f && f.kind === "image")) {
      const fileName = node.src.split("/").pop().split("?")[0] || "image";
      const imgFill = {
        kind: "image",
        url: node.src,
        fit,
        fileName,
        name: fileName,
        visible: true,
        blendMode: "normal",
      };
      node.style.fills = [imgFill, ...(node.style.fills || [])];
      node.style.fill = node.style.fills[0];
    }
  }

  return node;
}

/**
 * Measure HTML in a hidden off-screen iframe to recover exact layout geometry.
 */
export async function measureHtml(html, plainRoots) {
  if (typeof document === "undefined") return null;
  try {
    const plain = flattenElements(plainRoots);
    if (!plain.length) return null;
    const rootStyle = parseStyleAttribute(plainRoots[0]?.attrs?.style || "");
    const frameW = px(rootStyle.width) || 1440;
    const frameH = px(rootStyle.height) || 8000;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${frameW}px;height:${frameH}px;visibility:hidden;pointer-events:none;border:0;`;
    document.body.appendChild(iframe);
    try {
      const doc = iframe.contentDocument;
      if (!doc) return null;

      // Scan font families from HTML; always include Inter
      const fontsToLoad = new Set(["Inter"]);
      try {
        const extracted = extractFontFamiliesFromHtml(html);
        for (const f of extracted) fontsToLoad.add(f);
      } catch {}
      const fontLinks = buildGoogleFontLinks(fontsToLoad);

      // Determine if the HTML is a full document or a Paper/clipboard snapshot.
      // A "Paper snapshot" wraps in <x-paper-html> and carries all computed styles inline.
      // We detect it to avoid injecting Tailwind CDN (which would re-interpret UA styles).
      const isPaperSnapshot = /<x-paper-html[\s>]/i.test(html) || /paper-snapshot-original-tag/i.test(html);
      // isFullDoc: contains a real <html> element that is part of the actual content (not clipboard wrapper).
      // For clipboard-wrapped Paper snapshots, the outer <html><body> is the OS clipboard artifact.
      const isFullDoc = !isPaperSnapshot && /^<!doctype\s|^<html[\s>]/i.test(html.trim());
      const tailwindScript = `<script src="https://cdn.tailwindcss.com"></script>`;
      const defaultVars = `
<style>
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
  }
</style>`;

      doc.open();
      if (isFullDoc) {
        doc.write(html);
      } else if (isPaperSnapshot) {
        // Paper snapshot: all styles are inline computed values. We do NOT inject Tailwind
        // (it would recalculate classes and produce wrong sizes). We only inject fonts and
        // a minimal base reset to suppress UA defaults from causing noise.
        const paperReset = `<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 0; }
x-paper-html, x-snap { display: contents; }
</style>`;
        // Extract the raw <x-paper-html>…</x-paper-html> fragment from the clipboard wrapper
        let fragment = html;
        const paperStart = html.indexOf("<x-paper-html");
        if (paperStart !== -1) fragment = html.slice(paperStart);
        doc.write(`<!doctype html><html><head><meta charset="utf-8">\n${fontLinks}\n${paperReset}\n</head><body style="margin:0;padding:0">${fragment}</body></html>`);
      } else {
        doc.write(`<!doctype html><html><head><meta charset="utf-8">\n${fontLinks}\n${tailwindScript}\n${defaultVars}\n</head><body style="margin:0;padding:0">${html}</body></html>`);
      }
      doc.close();

      // Wait for fonts to be ready (up to 4000ms)
      await Promise.race([
        doc.fonts ? doc.fonts.ready : Promise.resolve(),
        new Promise((r) => setTimeout(r, 4000)),
      ]);

      // Wait for images to load (up to 4000ms)
      await Promise.race([
        Promise.all(
          Array.from(doc.images || []).map((img) =>
            img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; })
          )
        ),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      await new Promise((r) => setTimeout(r, 30));

      const origin = (doc.body.firstElementChild || doc.body).getBoundingClientRect();
      const map = new Map();

      function extractDomMetrics(domEl) {
        const r = domEl.getBoundingClientRect();
        const cs = doc.defaultView ? doc.defaultView.getComputedStyle(domEl) : null;
        return {
          x: Math.round((r.left - origin.left) * 100) / 100,
          y: Math.round((r.top - origin.top) * 100) / 100,
          w: Math.round(r.width * 100) / 100,
          h: Math.round(r.height * 100) / 100,
          computedWidth: cs ? cs.width : undefined,
          computedHeight: cs ? cs.height : undefined,
          computedDisplay: cs ? cs.display : undefined,
          computedBoxSizing: cs ? cs.boxSizing : undefined,
          computedFlex: cs ? cs.flex : undefined,
          computedFlexDirection: cs ? cs.flexDirection : undefined,
          computedFlexWrap: cs ? cs.flexWrap : undefined,
          computedFlexGrow: cs ? cs.flexGrow : undefined,
          computedFlexShrink: cs ? cs.flexShrink : undefined,
          computedJustifyContent: cs ? cs.justifyContent : undefined,
          computedAlignItems: cs ? cs.alignItems : undefined,
          computedRowGap: cs ? cs.rowGap : undefined,
          computedColumnGap: cs ? cs.columnGap : undefined,
          computedGap: cs ? cs.gap : undefined,
          computedGridTemplateColumns: cs ? cs.gridTemplateColumns : undefined,
          computedGridTemplateRows: cs ? cs.gridTemplateRows : undefined,
          computedGridAutoFlow: cs ? cs.gridAutoFlow : undefined,
          computedGridColumn: cs ? cs.gridColumn : undefined,
          computedGridRow: cs ? cs.gridRow : undefined,
          computedAlignSelf: cs ? cs.alignSelf : undefined,
          computedMargin: cs ? cs.margin : undefined,
          computedPadding: cs ? cs.padding : undefined,
          computedBackgroundColor: cs ? cs.backgroundColor : undefined,
          computedColor: cs ? cs.color : undefined,
          computedFontSize: cs ? cs.fontSize : undefined,
          computedFontWeight: cs ? cs.fontWeight : undefined,
          computedFontFamily: cs ? cs.fontFamily : undefined,
          computedLineHeight: cs ? cs.lineHeight : undefined,
          computedBorderTopWidth: cs ? cs.borderTopWidth : undefined,
          computedBorderRightWidth: cs ? cs.borderRightWidth : undefined,
          computedBorderBottomWidth: cs ? cs.borderBottomWidth : undefined,
          computedBorderLeftWidth: cs ? cs.borderLeftWidth : undefined,
          computedBorderTopColor: cs ? cs.borderTopColor : undefined,
          computedBorderRightColor: cs ? cs.borderRightColor : undefined,
          computedBorderBottomColor: cs ? cs.borderBottomColor : undefined,
          computedBorderLeftColor: cs ? cs.borderLeftColor : undefined,
          computedBorderTopStyle: cs ? cs.borderTopStyle : undefined,
          computedBorderTopLeftRadius: cs ? cs.borderTopLeftRadius : undefined,
          computedBorderTopRightRadius: cs ? cs.borderTopRightRadius : undefined,
          computedBorderBottomRightRadius: cs ? cs.borderBottomRightRadius : undefined,
          computedBorderBottomLeftRadius: cs ? cs.borderBottomLeftRadius : undefined,
          computedBoxShadow: cs ? cs.boxShadow : undefined,
          computedMaxWidth: cs ? cs.maxWidth : undefined,
          computedMinWidth: cs ? cs.minWidth : undefined,
        };
      }

      // 1. Recursive tree matching: matches plain tree structure to DOM tree structure
      function matchSubtree(plainNode, domNode) {
        if (!plainNode || !domNode) return;
        if (domNode.nodeType === 1 && plainNode.tag && domNode.tagName.toLowerCase() === plainNode.tag.toLowerCase()) {
          map.set(plainNode, extractDomMetrics(domNode));
        }
        const plainElementKids = (plainNode.children || []).filter((c) => c && typeof c.text !== "string");
        const domElementKids = Array.from(domNode.children || []);
        const len = Math.min(plainElementKids.length, domElementKids.length);
        for (let k = 0; k < len; k++) {
          matchSubtree(plainElementKids[k], domElementKids[k]);
        }
      }

      const plainElementRoots = plainRoots.filter((r) => r && typeof r.text !== "string");
      let domRoots = Array.from(doc.body.children || []);
      // Unwrap <html>, <body>, <x-paper-html>, <x-snap> wrappers matching unwrapRoots()
      for (let depth = 0; depth < 5; depth++) {
        if (domRoots.length === 1) {
          const first = domRoots[0];
          const t = first.tagName.toLowerCase();
          if (t === "x-paper-html" || t === "x-snap" || t === "body" || t === "html") {
            domRoots = Array.from(first.children || []);
            continue;
          }
        }
        break;
      }

      const rootLen = Math.min(plainElementRoots.length, domRoots.length);
      for (let r = 0; r < rootLen; r++) {
        matchSubtree(plainElementRoots[r], domRoots[r]);
      }

      // 2. Preorder sequential matching fallback for any elements not yet matched
      const domEls = Array.from(doc.body.querySelectorAll("*"));
      if (domEls.length !== plain.length) {
        console.warn(`[measureHtml] Measured element count (${domEls.length}) differs from plain tree count (${plain.length}).`);
      }
      const limit = Math.min(domEls.length, plain.length);
      for (let i = 0; i < limit; i += 1) {
        if (!map.has(plain[i]) && domEls[i].tagName.toLowerCase() === plain[i].tag.toLowerCase()) {
          map.set(plain[i], extractDomMetrics(domEls[i]));
        }
      }
      return map;
    } finally {
      iframe.remove();
    }
  } catch {
    return null;
  }
}

/**
 * Top-level async snapshot-to-canvas converter for clipboard / paste.
 */
export async function convertSnapshotToCanvasNodes(html, { measure = true, exactLayout = true } = {}) {
  const cleanHtml = extractPaperHtml(html) || html;
  if (typeof document !== "undefined") {
    ensureFonts(cleanHtml);
  }
  const plainRoots = parseHtmlFragment(cleanHtml);
  let measurements = null;
  if (measure && typeof document !== "undefined") {
    measurements = await measureHtml(cleanHtml, plainRoots);
  }
  const result = convertPlainTree(plainRoots, { measurements, exactLayout });
  for (const n of result.all) {
    formatNodeForCanvasTool(n);
  }
  return {
    type: "canvas-nodes-clip",
    version: 1,
    rootIds: result.roots.map((r) => r.id),
    nodes: Object.fromEntries(result.all.map((n) => [n.id, n])),
    roots: result.roots,
    all: result.all,
    stats: result.stats,
    imageJobs: result.imageJobs,
  };
}

