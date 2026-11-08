/**
 * htmlToCanvasNodes.js
 * Snap/Figma HTML importer.
 *
 * Reads inline style attributes on copied HTML and produces
 * canvas-tool nodes (frames, text, images) with basic style fidelity.
 */
import { normalizeCssColor } from "./color.js";
import { isIgnoredOtherStyle } from "./snapshot-import.js";

/**
 * cleanInlineHtml – strip everything except safe inline formatting tags and
 * span elements that carry a style attribute.  Used to preserve rich-text
 * formatting when a text leaf contains mixed inline spans.
 *
 * @param {string} raw - raw innerHTML string from the DOM element
 * @returns {string|null}
 */
function cleanInlineHtml(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Only keep inline formatting tags + span with style
  const ALLOWED = new Set(['span','strong','em','b','i','u','s','strike','br','a']);
  // Simple parser: strip non-style attributes from allowed tags, drop disallowed tags
  const cleaned = raw
    .replace(/<(\/?)([\w-]+)([^>]*)>/gi, (match, slash, tag, attrs) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return slash ? '' : ''; // drop unknown tags entirely
      if (slash) return `</${t}>`;
      // For span: keep only style attr
      const styleMatch = /style\s*=\s*["']([^"']*?)["']/i.exec(attrs);
      if (t === 'span' && styleMatch) return `<span style="${styleMatch[1]}">`;
      if (t === 'span') return ''; // span without style → drop (content still kept)
      if (t === 'br') return '<br>';
      return `<${t}>`;
    });
  return cleaned.trim() || null;
}

const CONSUMED_CORE_PROPS = new Set([
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
  "box-shadow", "opacity", "mix-blend-mode", "overflow",
  // Padding
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-block-start", "padding-block-end",
  "padding-inline", "padding-inline-start", "padding-inline-end",
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

function extractCustomCss(el) {
  const inlineStyleAttr = el.getAttribute ? el.getAttribute("style") || "" : "";
  const customCss = {};
  if (inlineStyleAttr) {
    inlineStyleAttr.split(";").forEach((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon > 0) {
        const prop = declaration.slice(0, colon).trim().toLowerCase();
        const val = declaration.slice(colon + 1).trim();
        if (!prop || !val || isIgnoredOtherStyle(prop, val)) return;
        customCss[prop] = { value: val, enabled: true };
      }
    });
  }
  return customCss;
}

function parseUnitPx(val, fallback = 0) {
  if (val == null) return fallback;
  if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
  let v = String(val).trim();
  if (!v) return fallback;
  if (v.startsWith("var(") && v.endsWith(")")) {
    const inner = v.slice(4, -1).trim();
    const comma = inner.indexOf(",");
    if (comma >= 0) v = inner.slice(comma + 1).trim();
  }
  const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(px|rem|em|pt|vw|vh|%)?$/i.exec(v);
  if (!m) {
    const num = parseFloat(v);
    return Number.isFinite(num) ? num : fallback;
  }
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return fallback;
  const unit = (m[2] || "").toLowerCase();
  switch (unit) {
    case "rem":
    case "em":
      return Math.round(num * 16 * 100) / 100;
    case "pt":
      return Math.round(num * 1.333333 * 100) / 100;
    case "vw":
      return Math.round(num * 14.4 * 100) / 100;
    case "vh":
      return Math.round(num * 9.0 * 100) / 100;
    case "%":
      return fallback;
    default:
      return num;
  }
}

function parsePx(val, fallback = 0) {
  return parseUnitPx(val, fallback);
}

function normalizeLineHeightValue(value, fontSize) {
  if (value == null || value === "" || value === "normal") return 1.25;
  let mult = null;
  if (typeof value === "number") mult = value;
  else if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "normal") return 1.25;
    if (v.endsWith("%")) mult = parseFloat(v) / 100;
    else if (v.endsWith("px")) mult = parseFloat(v) / fontSize;
    else if (v.endsWith("em") || v.endsWith("rem")) mult = parseFloat(v);
    else { const n = parseFloat(v); if (!Number.isFinite(n)) return 1.25; mult = n; }
  }
  if (mult == null || !Number.isFinite(mult)) return 1.25;
  if (mult > 5) mult = fontSize > 0 && mult / fontSize <= 2.5 ? mult / fontSize : mult / 100;
  if (mult > 2.0 || mult < 0.8) return 1.25;
  return Math.round(mult * 100) / 100;
}

function normalizeLineHeight(value, fontSize = 16) {
  return normalizeLineHeightValue(value, fontSize);
}

function buildBorder(style) {
  const sides = ["top", "right", "bottom", "left"];
  const result = [];
  for (const s of sides) {
    const w = parsePx(style[`border-${s}-width`]);
    const st = style[`border-${s}-style`] || style["border-style"] || "solid";
    const c = style[`border-${s}-color`] || style["border-color"] || "#000000";
    if (w > 0 && st !== "none" && st !== "hidden") {
      const norm = normalizeCssColor(c);
      result.push({
        side: s,
        width: Math.round(w),
        style: st,
        color: norm.hex,
        alpha: norm.alpha,
        opacity: Math.round(norm.alpha * 100),
        paint: { kind: "solid", color: norm.hex, alpha: norm.alpha },
      });
    }
  }
  if (result.length === 4) {
    const first = result[0];
    const allSame = result.every(b => b.width === first.width && b.style === first.style && b.paint.color === first.paint.color && b.paint.alpha === first.paint.alpha);
    if (allSame) {
      return [{
        side: "all",
        width: first.width,
        style: first.style,
        color: first.color,
        alpha: first.alpha,
        opacity: first.opacity,
        paint: first.paint,
      }];
    }
  }
  return result;
}

function splitComaOutsideParens(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(str.slice(start).trim());
  return parts;
}

function buildShadows(style) {
  const shadows = [];
  const bs = style["box-shadow"];
  if (!bs || bs === "none") return shadows;
  const parts = splitComaOutsideParens(bs);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const isInset = trimmed.includes("inset");
    const colorMatch = trimmed.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|hsla?\([^)]+\))/i);
    const rawColor = colorMatch ? colorMatch[1] : "rgba(0, 0, 0, 0.1)";
    const norm = normalizeCssColor(rawColor);
    const numStr = trimmed.replace(rawColor, "").replace("inset", "").trim();
    const nums = numStr.match(/-?[\d.]+/g);
    if (nums && nums.length >= 2) {
      shadows.push({
        kind: isInset ? "inner" : "drop",
        x: parseFloat(nums[0]) || 0,
        y: parseFloat(nums[1]) || 0,
        blur: parseFloat(nums[2]) || 0,
        spread: parseFloat(nums[3]) || 0,
        color: norm.hex,
        alpha: norm.alpha,
        opacity: Math.round(norm.alpha * 100),
      });
    }
  }
  return shadows;
}

function buildRadius(style) {
  const tl = parsePx(style["border-top-left-radius"]);
  const tr = parsePx(style["border-top-right-radius"]);
  const br = parsePx(style["border-bottom-right-radius"]);
  const bl = parsePx(style["border-bottom-left-radius"]);
  const corners = [tl, tr, br, bl];
  return corners.every((c) => c === corners[0]) ? corners[0] : { tl, tr, br, bl };
}

function buildGradientCss(cssStr) {
  if (!cssStr || typeof cssStr !== "string") return null;
  const trimmed = cssStr.trim();
  // Match gradient function name and extract inner content
  const gradMatch = trimmed.match(/^(linear-gradient|radial-gradient|conic-gradient)\s*\(/i);
  if (!gradMatch) return null;
  const fn = gradMatch[1];
  const gradientType = fn === "radial-gradient" ? "radial" : fn === "conic-gradient" ? "conic" : "linear";
  // Find matching closing paren
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "(" && start < 0) { start = i; depth++; continue; }
    if (start >= 0) {
      if (trimmed[i] === "(") depth++;
      else if (trimmed[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
  }
  if (end < 0) return null;
  const inner = trimmed.slice(start + 1, end);
  // Split by commas outside parentheses
  const parts = [], cur = "";
  depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  if (!parts.length) return null;
  let angle = 90;
  const firstPart = parts[0].toLowerCase();
  if (gradientType === "linear") {
    if (firstPart.includes("deg")) {
      const m = firstPart.match(/(-?\d+(?:\.\d+)?)deg/);
      if (m) angle = parseFloat(m[1]);
    } else if (firstPart.includes("to ")) {
      if (firstPart.includes("bottom") && firstPart.includes("right")) angle = 135;
      else if (firstPart.includes("bottom") && firstPart.includes("left")) angle = 225;
      else if (firstPart.includes("top") && firstPart.includes("right")) angle = 45;
      else if (firstPart.includes("top") && firstPart.includes("left")) angle = 315;
      else if (firstPart.includes("bottom")) angle = 180;
      else if (firstPart.includes("top")) angle = 0;
      else if (firstPart.includes("right")) angle = 90;
      else if (firstPart.includes("left")) angle = 270;
    }
  }
  const stopStartIndex = gradientType === "radial" && (parts[0].startsWith("circle") || parts[0].startsWith("ellipse") || parts[0].includes("at ")) ? 1 : 0;
  const rawStops = parts.slice(stopStartIndex);
  if (!rawStops.length) return null;
  const stops = [];
  rawStops.forEach((s, idx) => {
    const m = s.match(/^(.*?)(?:\s+(-?\d+(?:\.\d+)?)(%|px))$/);
    let colorStr = s, pct = null;
    if (m) { colorStr = m[1].trim(); const val = parseFloat(m[2]); pct = m[3] === "px" ? (val === 0 ? 0 : null) : val; }
    if (pct == null) pct = rawStops.length > 1 ? Math.round((idx / (rawStops.length - 1)) * 100) : 0;
    const norm = normalizeCssColor(colorStr);
    stops.push({ color: norm.hex, alpha: norm.alpha, at: pct });
  });
  return { kind: "gradient", gradientType, angle: Math.round(angle), stops };
}

function buildFill(style) {
  const fills = [];
  const isTextClip = style["background-clip"] === "text" || style["-webkit-background-clip"] === "text";
  const bgImg = style["background-image"] || style["background"] || "";
  if (bgImg && bgImg !== "none" && !isTextClip) {
    const layers = splitComaOutsideParens(bgImg);
    for (const layer of layers) {
      const trimmed = layer.trim();
      if (!trimmed || trimmed === "none") continue;
      const urlMatch = trimmed.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/i);
      if (urlMatch) fills.push({ kind: "image", url: urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? "", fit: "cover" });
      else { const grad = buildGradientCss(trimmed); if (grad) fills.push(grad); }
    }
  }
  const bgCol = style["background-color"];
  if (bgCol && bgCol !== "rgba(0, 0, 0, 0)" && bgCol !== "transparent") {
    const norm = normalizeCssColor(bgCol);
    fills.push({ kind: "solid", color: norm.hex, alpha: norm.alpha });
  }
  return fills;
}

function measureTextRect(text, style) {
  const span = document.createElement("span");
  span.style.cssText =
    "position:absolute;left:-99999px;top:-99999px;visibility:hidden;white-space:pre-wrap;" +
    "font-family:" + (style["font-family"] || "Inter") + ";" +
    "font-size:" + (style["font-size"] || "16px") + ";" +
    "font-weight:" + (style["font-weight"] || "400") + ";" +
    "line-height:" + (style["line-height"] || "1.25") + ";" +
    "letter-spacing:" + (style["letter-spacing"] || "0") + ";" +
    "text-transform:" + (style["text-transform"] || "none") + ";";
  span.textContent = text;
  document.body.appendChild(span);
  const r = span.getBoundingClientRect();
  document.body.removeChild(span);
  return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
}

function cssToPx(val, fallback = null) {
  if (val == null || val === "") return fallback;
  const num = parseFloat(val);
  return Number.isFinite(num) ? num : fallback;
}

export function parseHtmlToCanvasNodes(htmlString) {
  if (!htmlString || typeof htmlString !== "string") return null;
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return null;
  if (!/<[a-z][\s>]/i.test(htmlString.trim())) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  doc.querySelectorAll("script, style, link, meta, title, noscript, iframe, object, embed").forEach((e) => e.remove());

  const host = document.createElement("div");
  host.id = "imphost";
  host.style.cssText = "position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;z-index:-99999;overflow:visible;";
  host.innerHTML = doc.body.innerHTML || doc.documentElement.innerHTML;
  document.body.appendChild(host);

  const nodeDict = {};
  let seq = 1;
  const genId = (prefix) => `${prefix}_${Date.now().toString(36)}_${seq++}`;

  function processElement(el, parentId = null, parentRect = null) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = el.tagName.toLowerCase();
    if (["script","style","noscript","link","meta"].includes(tag)) return null;

    const cs = getComputedStyle(el);
    if (cs.display === "none" || el.style.display === "none" || el.style.visibility === "hidden") return null;

    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return null;

    const style = {};
    for (let i = 0; i < cs.length; i++) style[cs[i]] = cs.getPropertyValue(cs[i]);

    const isRoot = !parentId;
    const isAbs = cs.position === "absolute" || cs.position === "fixed";

    // Image / video / canvas / svg
    if (["img","video","canvas","svg"].includes(tag)) {
      const id = genId(tag);
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const fit = style["object-fit"] === "contain" ? "contain" : "cover";
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      let posX = 0, posY = 0;
      if (isRoot) {
        posX = 0; posY = 0;
      } else {
        const parentIsFlex = parentId ? nodeDict[parentId]?.layout?.mode === "flex" : false;
        if (!isAbs && parentIsFlex) {
          posX = 0; posY = 0; // Flex child: parent handles layout
        } else if (parentRect) {
          posX = Math.round(r.left - parentRect.left);
          posY = Math.round(r.top - parentRect.top);
        } else {
          posX = 0; posY = 0;
        }
      }
      const elemCustomCss = extractCustomCss(el);
      nodeDict[id] = {
        id, type: tag === "svg" ? "svg" : "image",
        name: el.getAttribute("alt") ? `Image: ${el.getAttribute("alt").slice(0,24)}` : tag.toUpperCase(),
        parentId: parentId || null, childIds: [],
        layout: { mode: "freeform" },
        x: posX, y: posY,
        position: isAbs ? { x: posX, y: posY, absolute: true } : { x: posX, y: posY },
        size: { w: { kind: "fixed", px: w }, h: { kind: "fixed", px: h } },
        style: {
          fill: { kind: "none" },
          opacity: parseFloat(style.opacity) || 1,
          ...(Object.keys(elemCustomCss).length ? { customCss: elemCustomCss } : {}),
        },
        rawStyle: Object.keys(elemCustomCss).length ? Object.fromEntries(Object.entries(elemCustomCss).map(([k, v]) => [k, v.value])) : undefined,
        image: { assetId: src || `asset-${id}`, fit },
        ...(tag === "svg" ? { svgOuterHtml: el.outerHTML || "", fill: style["fill"] || "currentColor", stroke: style["stroke"] || undefined, viewBox: el.getAttribute("viewBox") || `0 0 ${w} ${h}` } : {}),
      };

      if (tag === "svg") {
        processSvgElements(el, id, {
          color: style.color || "currentColor",
          fill: style["fill"] || el.getAttribute("fill") || undefined,
          stroke: style["stroke"] || el.getAttribute("stroke") || undefined,
          strokeWidth: el.getAttribute("stroke-width") || style["stroke-width"],
        });
      } else {
        for (const child of el.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            processElement(child, id, r);
          }
        }
      }
      return id;
    }

    function processSvgElements(parentEl, parentId, inherited = {}) {
      for (const child of Array.from(parentEl.children || [])) {
        const cTag = (child.tagName || "").toLowerCase();
        if (["defs", "clippath", "mask", "style", "title", "desc", "metadata"].includes(cTag)) continue;

        const rawFill = child.getAttribute("fill") || child.style?.fill || inherited.fill;
        const rawStroke = child.getAttribute("stroke") || child.style?.stroke || inherited.stroke;
        const strokeW = parseFloat(child.getAttribute("stroke-width") || child.style?.strokeWidth || inherited.strokeWidth) || (rawStroke && rawStroke !== "none" ? 1.3 : 0);
        const strokeLinecap = child.getAttribute("stroke-linecap") || child.style?.strokeLinecap || inherited.strokeLinecap || "round";
        const strokeLinejoin = child.getAttribute("stroke-linejoin") || child.style?.strokeLinejoin || inherited.strokeLinejoin || "round";
        const fillRule = child.getAttribute("fill-rule") || child.style?.fillRule || inherited.fillRule || "nonzero";
        const clipRule = child.getAttribute("clip-rule") || child.style?.clipRule || inherited.clipRule;
        const transform = child.getAttribute("transform") || child.style?.transform || null;
        const opacity = parseFloat(child.getAttribute("opacity") || child.style?.opacity || inherited.opacity) || 1;

        let fill = rawFill;
        let stroke = rawStroke;
        if (fill === "none") fill = null;
        if (stroke === "none") stroke = null;
        if (fill === "currentColor") fill = inherited.color || "#18181B";
        if (stroke === "currentColor") stroke = inherited.color || "#18181B";

        const childInherited = {
          color: inherited.color || "#18181B",
          fill: rawFill,
          stroke: rawStroke,
          strokeWidth: strokeW,
          strokeLinecap,
          strokeLinejoin,
          fillRule,
          clipRule,
          opacity,
        };

        if (cTag === "rect") {
          const hasExplicitStroke = Boolean(
            (child.getAttribute("stroke") && child.getAttribute("stroke") !== "none" && child.getAttribute("stroke") !== "transparent") ||
            (child.style?.stroke && child.style.stroke !== "none" && child.style.stroke !== "transparent")
          );
          const isTransparentFill = !fill || fill === "none" || fill === "transparent" || rawFill === "none" || child.getAttribute("fill") === "none";
          if (isTransparentFill && !hasExplicitStroke) {
            // Invisible SVG bounding box/click target - skip creating phantom layer
            continue;
          }
        }

        if (cTag === "g") {
          const gId = genId("group");
          const groupNode = {
            id: gId,
            type: "group",
            name: child.id ? child.id.charAt(0).toUpperCase() + child.id.slice(1) : "Group",
            parentId,
            childIds: [],
            position: { x: 0, y: 0 },
            size: { w: { kind: "fixed", px: 24 }, h: { kind: "fixed", px: 24 } },
            transform: transform || undefined,
            fillRule,
            clipRule: clipRule || undefined,
            style: {
              opacity,
              fill: fill && fill !== "none" ? { kind: "solid", color: fill } : null,
              stroke: stroke && stroke !== "none" ? { width: strokeW, paint: { kind: "solid", color: stroke, alpha: 1 } } : null,
            },
          };
          nodeDict[gId] = groupNode;
          nodeDict[parentId]?.childIds.push(gId);
          processSvgElements(child, gId, childInherited);
          continue;
        }

        let d = "";
        if (cTag === "path") {
          d = child.getAttribute("d") || "";
        } else if (cTag === "polygon" || cTag === "polyline") {
          const coords = (child.getAttribute("points") || "").trim().match(/-?[\d.]+(?:e-?\d+)?/gi);
          if (coords && coords.length >= 4) {
            d = `M ${coords[0]} ${coords[1]}`;
            for (let i = 2; i < coords.length - 1; i += 2) d += ` L ${coords[i]} ${coords[i + 1]}`;
            if (cTag === "polygon") d += " Z";
          }
        } else if (cTag === "line") {
          const x1 = parseFloat(child.getAttribute("x1")) || 0;
          const y1 = parseFloat(child.getAttribute("y1")) || 0;
          const x2 = parseFloat(child.getAttribute("x2")) || 0;
          const y2 = parseFloat(child.getAttribute("y2")) || 0;
          d = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else if (cTag === "rect") {
          const rx = parseFloat(child.getAttribute("rx")) || 0;
          const ry = parseFloat(child.getAttribute("ry")) || rx || 0;
          const x = parseFloat(child.getAttribute("x")) || 0;
          const y = parseFloat(child.getAttribute("y")) || 0;
          const rw = parseFloat(child.getAttribute("width")) || 0;
          const rh = parseFloat(child.getAttribute("height")) || 0;
          if (rw > 0 && rh > 0) {
            if (rx > 0 || ry > 0) {
              const effRx = Math.min(rx || ry, rw / 2);
              const effRy = Math.min(ry || rx, rh / 2);
              d = `M ${x + effRx} ${y} h ${rw - 2 * effRx} a ${effRx} ${effRy} 0 0 1 ${effRx} ${effRy} v ${rh - 2 * effRy} a ${effRx} ${effRy} 0 0 1 -${effRx} ${effRy} h -${rw - 2 * effRx} a ${effRx} ${effRy} 0 0 1 -${effRx} -${effRy} v -${rh - 2 * effRy} a ${effRx} ${effRy} 0 0 1 ${effRx} -${effRy} Z`;
            } else {
              d = `M ${x} ${y} h ${rw} v ${rh} h -${rw} Z`;
            }
          }
        } else if (cTag === "circle") {
          const cx = parseFloat(child.getAttribute("cx")) || 0;
          const cy = parseFloat(child.getAttribute("cy")) || 0;
          const r = parseFloat(child.getAttribute("r")) || 0;
          if (r > 0) d = `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 -${2 * r} 0 Z`;
        } else if (cTag === "ellipse") {
          const cx = parseFloat(child.getAttribute("cx")) || 0;
          const cy = parseFloat(child.getAttribute("cy")) || 0;
          const rx = parseFloat(child.getAttribute("rx")) || 0;
          const ry = parseFloat(child.getAttribute("ry")) || 0;
          if (rx > 0 && ry > 0) d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 -${2 * rx} 0 Z`;
        }

        if (!d) continue;

        const pId = genId(cTag === "polygon" ? "polygon" : "path");
        const effectiveFill = fill || (stroke ? null : (rawFill === "none" ? null : (inherited.color || "#18181B")));
        const pathNode = {
          id: pId,
          type: cTag === "polygon" ? "polygon" : "path",
          name: child.id ? child.id.charAt(0).toUpperCase() + child.id.slice(1) : (cTag.charAt(0).toUpperCase() + cTag.slice(1)),
          parentId,
          childIds: [],
          position: { x: 0, y: 0 },
          size: { w: { kind: "fixed", px: 24 }, h: { kind: "fixed", px: 24 } },
          d,
          fillRule,
          clipRule: clipRule || undefined,
          strokeLinecap,
          strokeLinejoin,
          transform: transform || undefined,
          fill: effectiveFill || "none",
          stroke: stroke || undefined,
          strokeWidth: stroke ? strokeW : 0,
          style: {
            fill: effectiveFill ? { kind: "solid", color: effectiveFill } : null,
            stroke: stroke ? { width: strokeW, paint: { kind: "solid", color: stroke, alpha: 1 } } : null,
            opacity,
            fillRule,
            clipRule: clipRule || undefined,
          },
        };
        nodeDict[pId] = pathNode;
        nodeDict[parentId]?.childIds.push(pId);
      }
    }

    // Determine if text leaf
    const children = Array.from(el.children).filter(c => !["script","style"].includes(c.tagName.toLowerCase()));
    const hasBox = Boolean(
      (style["background-color"] && style["background-color"] !== "rgba(0,0,0,0)" && style["background-color"] !== "transparent") ||
      (style["background-image"] && style["background-image"] !== "none") ||
      parsePx(style["border-radius"] || style["border-top-left-radius"] || 0) > 0 ||
      buildBorder(style).length > 0 ||
      buildShadows(style).length > 0 ||
      style.display === "flex" || style.display === "grid" ||
      style.gap || style["column-gap"] || style["row-gap"] ||
      tag === "button"
    );

    const isTextLeaf = (() => {
      if (children.length === 0) {
        if (!el.textContent || !el.textContent.trim()) return false;
        if (!hasBox || ["span","p","h1","h2","h3","h4","h5","h6","b","strong","em","i","a"].includes(tag)) return true;
        return false;
      }
      if (hasBox) return false;
      const inline = new Set(["b","strong","i","em","u","s","span","small","sub","sup","br","a","code","abbr","mark","label","time"]);
      const check = (n) => {
        const t = n.tagName.toLowerCase();
        if (!inline.has(t)) return false;
        const cs2 = {};
        for (let i = 0; i < getComputedStyle(n).length; i++) cs2[getComputedStyle(n)[i]] = getComputedStyle(n).getPropertyValue(getComputedStyle(n)[i]);
        if ((cs2["background-color"] && cs2["background-color"] !== "transparent") || parsePx(cs2["border-radius"] || 0) > 0) return false;
        for (const gc of n.children) if (!check(gc)) return false;
        return true;
      };
      return children.every(check);
    })();

    // Text node
    if (isTextLeaf) {
      const rawText = el.textContent.replace(/[\\u200B-\\u200D\\uFEFF]/g, "").replace(/\\s+/g, " ").trim();
      if (!rawText) return null;
      const fs = Math.round(parsePx(style["font-size"])) || 16;
      const fw = parseInt(style["font-weight"], 10) || 400;
      const ff = style["font-family"] ? style["font-family"].split(",")[0].replace(/["']/g, "").trim() : "Inter";
      const lh = normalizeLineHeightValue(style["line-height"], fs);
      const ls = style["letter-spacing"] || "0";
      const ta = style["text-align"] || "left";
      const ts = style["text-transform"] || "none";
      let content = rawText;
      if (ts === "uppercase") content = content.toUpperCase();
      else if (ts === "lowercase") content = content.toLowerCase();
      // Preserve inline rich-text formatting when mixed styled spans are present
      const rawHtml = typeof el.innerHTML === 'string' ? el.innerHTML : null;
      const hasStyledSpans = rawHtml && /<span\s[^>]*?style\s*=/i.test(rawHtml);
      const richHtml = hasStyledSpans ? cleanInlineHtml(rawHtml) : null;
      const measured = measureTextRect(rawText, style);
      const w = cssToPx(style["width"]) !== null ? Math.round(cssToPx(style["width"])) : measured.w;
      const h = cssToPx(style["height"]) !== null ? Math.round(cssToPx(style["height"])) : measured.h;
      const color = normalizeCssColor(style["color"] || "#18181B");
      const textShadow = style["text-shadow"] || style["-webkit-text-stroke"];

      // Check for gradient text
      const isTextClip = style["background-clip"] === "text" || style["-webkit-background-clip"] === "text";
      const bgImg = style["background-image"] || style["background"] || "";
      const hasGrad = bgImg && (bgImg.includes("gradient(") || bgImg.includes("-gradient("));
      let fillObj = { kind: "solid", color: color.hex, alpha: color.alpha };
      let gradPaint = null;
      if (hasGrad && (isTextClip || color.alpha === 0)) {
        gradPaint = buildGradientCss(bgImg);
        if (gradPaint) fillObj = gradPaint;
      }

      let posX = 0, posY = 0;
      if (isRoot) {
        posX = 0; posY = 0;
      } else {
        const parentIsFlex = parentId ? nodeDict[parentId]?.layout?.mode === "flex" : false;
        if (!isAbs && parentIsFlex) {
          posX = 0; posY = 0;
        } else if (parentRect) {
          posX = Math.round(r.left - parentRect.left);
          posY = Math.round(r.top - parentRect.top);
        } else {
          posX = 0; posY = 0;
        }
      }
      const id = genId("text");
      const textCustomCss = extractCustomCss(el);
      const textRawStyle = {
        ...(Object.keys(textCustomCss).length ? Object.fromEntries(Object.entries(textCustomCss).map(([k, v]) => [k, v.value])) : {}),
        ...(isTextClip || gradPaint ? {
          "background-clip": "text",
          "-webkit-background-clip": "text",
          "-webkit-text-fill-color": "transparent",
        } : {}),
      };
      nodeDict[id] = {
        id, type: "text", name: rawText.slice(0,30),
        parentId: parentId || null, childIds: [],
        layout: { mode: "freeform" },
        x: posX, y: posY,
        position: isAbs ? { x: posX, y: posY, absolute: true } : { x: posX, y: posY },
        size: { w: { kind: isTextClip ? "fill" : "fit", px: w }, h: { kind: "fit", px: h } },
        style: {
          fill: fillObj,
          fills: [fillObj],
          opacity: parseFloat(style.opacity) || 1,
          ...(textShadow ? { textShadow } : {}),
          ...(Object.keys(textCustomCss).length ? { customCss: textCustomCss } : {}),
        },
        rawStyle: Object.keys(textRawStyle).length ? textRawStyle : undefined,
        text: {
          content, fontSize: fs, fontWeight: fw, fontFamily: ff,
          lineHeight: lh, letterSpacing: ls, align: ta,
          verticalAlign: "top", wrap: "none",
          ...(ts !== "none" ? { textTransform: ts === "uppercase" ? "upper" : ts === "lowercase" ? "lower" : undefined } : {}),
          // Rich-text HTML: set when inline spans with style attributes are present
          ...(richHtml ? { html: richHtml } : {}),
        },
      };
      return id;
    }

    // Frame / container
    const id = genId("frame");
    const fills = buildFill(style);
    const borders = buildBorder(style);
    const shadows = buildShadows(style);
    const radius = buildRadius(style);
    const opacity = parseFloat(style.opacity) || 1;
    const blendMode = style["mix-blend-mode"] && style["mix-blend-mode"] !== "normal" ? style["mix-blend-mode"] : undefined;
    const overflow = (style["overflow"] === "hidden" || (style["overflow-x"] === "hidden" && style["overflow-y"] === "hidden")) ? "hidden" : "visible";
    const display = (style.display || "").toLowerCase();
    const isFlex = display === "flex" || display === "inline-flex";
    const isGrid = display === "grid" || display === "inline-grid";
    let layout = { mode: "freeform" };
    if (isFlex) {
      const dir = style["flex-direction"] || "row";
      const gap = parsePx(style.gap || style["column-gap"] || style["row-gap"]);
      const padT = parsePx(style["padding-top"] || style["padding-block-start"] || 0);
      const padR = parsePx(style["padding-right"] || style["padding-inline-end"] || 0);
      const padB = parsePx(style["padding-bottom"] || style["padding-block-end"] || 0);
      const padL = parsePx(style["padding-left"] || style["padding-inline-start"] || 0);
      layout = {
        mode: "flex",
        direction: dir.startsWith("column") ? "column" : "row",
        reverse: dir.endsWith("-reverse"),
        wrap: style["flex-wrap"] === "wrap",
        gap: gap > 0 ? gap : 0,
        padding: {
          t: padT, r: padR, b: padB, l: padL,
          h: padL === padR ? padL : padL,
          v: padT === padB ? padT : padT,
        },
        alignMain: style["justify-content"] === "center" ? "center" : style["justify-content"] === "flex-end" ? "end" : style["justify-content"] === "space-between" ? "space-between" : "start",
        alignCross: style["align-items"] === "center" ? "center" : style["align-items"] === "flex-end" ? "end" : style["align-items"] === "flex-start" ? "start" : "stretch",
      };
    } else if (isGrid) {
      const gap = parsePx(style.gap || style["column-gap"] || style["row-gap"]);
      const colGap = parsePx(style["column-gap"] || style.gap);
      const rowGap = parsePx(style["row-gap"] || style.gap);
      const padT = parsePx(style["padding-top"] || style["padding-block-start"] || 0);
      const padR = parsePx(style["padding-right"] || style["padding-inline-end"] || 0);
      const padB = parsePx(style["padding-bottom"] || style["padding-block-end"] || 0);
      const padL = parsePx(style["padding-left"] || style["padding-inline-start"] || 0);
      layout = {
        mode: "grid",
        display,
        columns: style["grid-template-columns"] || "repeat(2, 1fr)",
        rows: style["grid-template-rows"] || "auto",
        autoFlow: style["grid-auto-flow"] || "row",
        autoColumns: style["grid-auto-columns"] || "auto",
        autoRows: style["grid-auto-rows"] || "auto",
        gap: gap > 0 ? gap : 0,
        columnGap: colGap > 0 ? colGap : 0,
        rowGap: rowGap > 0 ? rowGap : 0,
        justifyItems: style["justify-items"] || "stretch",
        alignItems: style["align-items"] || "stretch",
        justifyContent: style["justify-content"] || "start",
        alignContent: style["align-content"] || "start",
        padding: {
          t: padT, r: padR, b: padB, l: padL,
          h: padL === padR ? padL : padL,
          v: padT === padB ? padT : padT,
        },
        areas: style["grid-template-areas"] || "",
      };
    }

    const gridLayout = (style["grid-column"] || style["grid-row"] || style["grid-area"] || style["justify-self"] || style["align-self"] || style["order"]) ? {
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
    } : undefined;
    const w = Math.round(r.width);
    const h = Math.round(r.height);

    const rawW = (style["width"] || "").trim().toLowerCase();
    const rawH = (style["height"] || "").trim().toLowerCase();
    const hasExplicitW = rawW && rawW !== "auto";
    const hasExplicitH = rawH && rawH !== "auto";

    let sizeW;
    if (rawW === "fit-content" || rawW === "max-content" || rawW === "min-content" || rawW === "fit" || rawW === "hug") {
      sizeW = { kind: "fit", px: w };
    } else if (rawW === "100%" || rawW === "100vw" || rawW === "fill" || parseFloat(style["flex-grow"]) >= 1) {
      sizeW = { kind: "fill", px: w };
    } else if (rawW.endsWith("%")) {
      sizeW = { kind: "relative", pct: parseFloat(rawW) || 100, px: w };
    } else if (hasExplicitW) {
      sizeW = { kind: "fixed", px: w };
    } else if (isFlex || tag === "button" || tag === "a" || tag === "span") {
      sizeW = { kind: "fit", px: w };
    } else {
      sizeW = isRoot ? { kind: "fixed", px: w } : { kind: "fit", px: w };
    }

    let sizeH;
    if (rawH === "fit-content" || rawH === "max-content" || rawH === "min-content" || rawH === "fit" || rawH === "hug" || rawH === "auto") {
      sizeH = { kind: "fit", px: h };
    } else if (rawH === "100%" || rawH === "100vh" || rawH === "fill") {
      sizeH = { kind: "fill", px: h };
    } else if (rawH.endsWith("%")) {
      sizeH = { kind: "relative", pct: parseFloat(rawH) || 100, px: h };
    } else if (hasExplicitH) {
      sizeH = { kind: "fixed", px: h };
    } else {
      sizeH = { kind: "fit", px: h };
    }

    let posX = 0, posY = 0;
    if (isRoot) {
      posX = 0; posY = 0;
    } else {
      const parentIsFlex = parentId ? nodeDict[parentId]?.layout?.mode === "flex" : false;
      const parentIsGrid = parentId ? nodeDict[parentId]?.layout?.mode === "grid" : false;
      if (!isAbs && (parentIsFlex || parentIsGrid)) {
        posX = 0; posY = 0;
      } else if (parentRect) {
        posX = Math.round(r.left - parentRect.left);
        posY = Math.round(r.top - parentRect.top);
      } else {
        posX = 0; posY = 0;
      }
    }
    const outerShadows = shadows.filter((s) => s.kind !== "inner");
    const innerShadows = shadows.filter((s) => s.kind === "inner");
    const frameCustomCss = extractCustomCss(el);

    const node = {
      id, type: "frame", name: tag === "button" ? "Button" : "Frame",
      parentId: parentId || null, childIds: [],
      layout,
      ...(gridLayout ? { gridLayout } : {}),
      x: isRoot ? 0 : posX, y: isRoot ? 0 : posY,
      position: isRoot ? { x: 0, y: 0 } : isAbs ? { x: posX, y: posY, absolute: true } : { x: posX, y: posY },
      size: { w: sizeW, h: sizeH },
      style: {
        fill: fills.length ? fills[0] : { kind: "none" },
        fills: fills.length > 1 ? fills : undefined,
        radius,
        borders: borders.length ? borders : undefined,
        border: borders.length ? borders[0] : undefined,
        shadow: outerShadows.length ? outerShadows : undefined,
        shadows: outerShadows.length ? outerShadows : undefined,
        innerShadow: innerShadows.length ? innerShadows : undefined,
        innerShadows: innerShadows.length ? innerShadows : undefined,
        opacity, blendMode, overflow,
        ...(typeof radius !== "number" ? { radius } : {}),
        ...(Object.keys(frameCustomCss).length ? { customCss: frameCustomCss } : {}),
      },
      rawStyle: Object.keys(frameCustomCss).length ? Object.fromEntries(Object.entries(frameCustomCss).map(([k, v]) => [k, v.value])) : undefined,
    };
    nodeDict[id] = node;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const cid = processElement(child, id, r);
        if (cid) node.childIds.push(cid);
      }
    }
    return id;
  }

  const paperRoot = host.querySelector("x-paper-html, x-snap");
  let rootEl = paperRoot ? (paperRoot.firstElementChild || paperRoot) : (host.firstElementChild || host);
  if (!rootEl) { document.body.removeChild(host); return null; }
  const rootId = processElement(rootEl, null, null);
  if (!rootId) { document.body.removeChild(host); return null; }
  if (nodeDict[rootId]) delete nodeDict[rootId].position?.absolute;
  for (const node of Object.values(nodeDict)) {
    if (node.type === "frame" && node.layout?.mode !== "flex" && node.childIds && node.childIds.length > 0) {
      const allAbs = node.childIds.every((cid) => Boolean(nodeDict[cid]?.position?.absolute));
      if (allAbs) {
        node.layout = { mode: "freeform" };
        for (const cid of node.childIds) if (nodeDict[cid]) delete nodeDict[cid].position?.absolute;
      }
    }
  }
  document.body.removeChild(host);
  return { type: "canvas-nodes-clip", version: 1, rootIds: [rootId], nodes: nodeDict };
}