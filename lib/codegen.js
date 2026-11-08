import { cleanAndNormalizeHtml } from "./richtext.js";
import { extractFontFamiliesFromHtml } from "./google-fonts.js";

/** Extract effective font metrics from text node, prioritizing rich-text html spans if present. */
export function getEffectiveTextMetrics(node) {
  const t = node.text ?? {};
  let fontSize = t.fontSize ?? 16;
  let align = t.align ?? "left";
  let fontFamily = t.fontFamily || null;

  if (t.html) {
    const fsMatch = t.html.match(/font-size:\s*(\d+(?:\.\d+)?)\s*px/i);
    if (fsMatch && fsMatch[1]) {
      const parsed = parseFloat(fsMatch[1]);
      if (parsed > 0) fontSize = parsed;
    }
    const alignMatch = t.html.match(/text-align:\s*(left|center|right|justify)/i);
    if (alignMatch && alignMatch[1]) {
      align = alignMatch[1].toLowerCase();
    }
    if (!fontFamily) {
      const fams = extractFontFamiliesFromHtml(t.html);
      if (fams.length > 0) fontFamily = fams[0];
    }
  }

  return { fontSize, align, fontFamily, lineHeight: t.lineHeight ?? 1.4 };
}

/**
 * Returns a semantic HTML tag (h1-h6 or p) based on effective font size & weight.
 */
export function getTextTag(node) {
  const metrics = getEffectiveTextMetrics(node);
  const size = metrics.fontSize || node?.text?.fontSize || 16;
  if (size >= 36) return "h1";
  if (size >= 28) return "h2";
  if (size >= 22) return "h3";
  if (size >= 18) return "h4";
  if (size >= 16) {
    return (node?.text?.fontWeight >= 600) ? "h5" : "p";
  }
  return "p";
}

/**
 * Copy-as code generators (M3) — pure functions from a document subtree to
 * CSS, Tailwind JSX, or a React component.
 *
 * Because the document model is CSS-shaped (Phase 5 §1: "the design
 * already is CSS"), these are translators, not re-interpreters:
 * - freeform children export as absolutely-positioned boxes;
 * - flex frames export as real CSS flexbox, including the spec's Fill rule
 *   (first Fill child takes the remainder, later Fill children get 0);
 * - token-bound values export as var(--token-name), and the file's tokens
 *   are emitted once as a `:root` block (CSS) or referenced by name.
 *
 * Import-free like lib/model.js / lib/flex.js (small helpers are mirrored
 * locally) so scripts/codegen-test.mjs can load it standalone.
 */

// ---------------------------------------------------------------------------
// Small helpers (mirrored from lib/model.js / lib/flex.js)
// ---------------------------------------------------------------------------

/** "Brand / Primary" -> "brand-primary" (CSS class / var safe). */
export function slugify(name) {
  const s = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "node";
}

/** "Hero frame" -> "HeroFrame" (React component name). */
export function pascalCase(name) {
  const parts = String(name ?? "").split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const out = parts
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
  return /^[A-Za-z]/.test(out) ? out : `Node${out || ""}`;
}

/** Alias-chain token resolution (mirrors model.resolveToken). */
export function resolveTokenValue(tokens, id) {
  let token = (tokens ?? []).find((t) => t.id === id);
  const seen = new Set();
  while (token && token.aliasOf && !seen.has(token.id)) {
    seen.add(token.id);
    token = tokens.find((t) => t.id === token.aliasOf);
  }
  return token ? token.value : undefined;
}

export function getTokenById(tokens, id) {
  return (tokens ?? []).find((t) => t.id === id);
}

/** CSS variable name for a token: --brand-primary. */
export function tokenVarName(token) {
  return `--${slugify(token.name)}`;
}

/** `var(--brand-primary)` reference for a token id. */
export function tokenVarRef(tokens, id) {
  const t = getTokenById(tokens, id);
  return t ? `var(${tokenVarName(t)})` : undefined;
}

const PX_TOKEN_TYPES = new Set([
  "spacing",
  "radius",
  "container",
  "breakpoint",
  "fontSize",
]);

/** Literal value of a token as a CSS value (numbers get px where apt). */
export function tokenCssValue(token, tokens) {
  const v = resolveTokenValue(tokens, token.id);
  if (v == null) return "";
  if (typeof v === "number") {
    return PX_TOKEN_TYPES.has(token.type) ? `${v}px` : String(v);
  }
  return String(v);
}

/** Hex + alpha colour -> CSS colour string (mirrors model.cssColor). */
export function cssColor(color, alpha) {
  if (color == null) return color;
  if (alpha == null || alpha >= 1) return color;
  const a = Math.max(0, alpha);
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const short = /^#([0-9a-f]{3})$/i.exec(color);
  if (short) {
    const [r, g, b] = short[1].split("").map((c) => parseInt(c + c, 16));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
}

function gradientCss(paint) {
  const stops = (paint.stops ?? [])
    .map((s) => `${cssColor(s.color, s.alpha)} ${s.at}%`)
    .join(", ");
  const angle = paint.angle ?? 90;
  if (paint.gradientType === "radial") return `radial-gradient(circle, ${stops})`;
  if (paint.gradientType === "conic") return `conic-gradient(from ${angle}deg, ${stops})`;
  return `linear-gradient(${angle}deg, ${stops})`;
}

/** Helper to extract all visible fills from a node. */
export function getVisibleFills(node) {
  const fills = node?.style?.fills?.length
    ? node.style.fills
    : node?.style?.fill
      ? [node.style.fill]
      : [];
  return fills.filter((f) => f && f.visible !== false && !f.hidden);
}

/** Helper to extract the primary visible fill from a node. */
export function getPrimaryVisibleFill(node) {
  const visible = getVisibleFills(node);
  return visible.length ? visible[0] : null;
}

export function fitCss(fit) {
  switch (fit) {
    case "contain":
      return "contain";
    case "fill":
      return "100% 100%";
    case "tile":
      return "auto";
    case "cover":
    default:
      return "cover";
  }
}

/** Resolve image source URL from an assetId, url, src, or fileName fallback. */
export function resolveImageSrc(paintOrImage, doc) {
  if (!paintOrImage) return undefined;
  const assetId = paintOrImage.assetId;
  if (assetId && doc?.assets?.[assetId]) return doc.assets[assetId];
  if (paintOrImage.url) return paintOrImage.url;
  if (paintOrImage.src) return paintOrImage.src;
  if (paintOrImage.fileName) return `./${paintOrImage.fileName}`;
  return undefined;
}

/** Extract full structured fill info (solid, gradient, image, multiple fills). */
export function getFillInfo(node, doc) {
  const visible = getVisibleFills(node);
  const solidFill = visible.find((f) => f && (f.kind === "solid" || (!f.kind && f.color) || f.kind === "token"));
  const gradientFill = visible.find((f) => f && f.kind === "gradient");
  const imageFill = visible.find((f) => f && f.kind === "image");

  let imageSrc = undefined;
  let imageFit = "cover";
  let imageRepeat = "no-repeat";

  if (imageFill) {
    imageSrc = resolveImageSrc(imageFill, doc);
    imageFit = fitCss(imageFill.fit);
    imageRepeat = imageFill.fit === "tile" ? "repeat" : "no-repeat";
  } else if (node?.type === "image" && (node.image?.assetId || node.image?.url || node.image?.fileName || node.image?.src)) {
    imageSrc = resolveImageSrc(node.image, doc);
    imageFit = fitCss(node.image?.fit);
    imageRepeat = node.image?.fit === "tile" ? "repeat" : "no-repeat";
  }

  const solidColor = solidFill ? (paintColorCss(solidFill, doc?.tokens) || cssColor(solidFill.color, solidFill.alpha)) : undefined;
  const gradientStyle = gradientFill ? gradientCss(gradientFill) : undefined;

  let layered = null;
  if (visible.length > 1) {
    const bgImages = [];
    const bgSizes = [];
    const bgPositions = [];
    const bgRepeats = [];
    const blendModes = [];
    for (const fill of visible) {
      const blend = fill.blendMode || "normal";
      blendModes.push(blend);
      if (fill.kind === "gradient") {
        bgImages.push(gradientCss(fill) || "none");
        bgSizes.push("100% 100%");
        bgPositions.push("center");
        bgRepeats.push("no-repeat");
      } else if (fill.kind === "image" || (fill.assetId || fill.url || fill.fileName)) {
        const src = resolveImageSrc(fill, doc);
        if (src) {
          bgImages.push(`url('${src}')`);
          bgSizes.push(fitCss(fill.fit));
          bgPositions.push("center");
          bgRepeats.push(fill.fit === "tile" ? "repeat" : "no-repeat");
        }
      } else {
        const color = paintColorCss(fill, doc?.tokens) || cssColor(fill.color, fill.alpha) || "#FFFFFF";
        bgImages.push(`linear-gradient(${color}, ${color})`);
        bgSizes.push("100% 100%");
        bgPositions.push("center");
        bgRepeats.push("no-repeat");
      }
    }
    if (bgImages.length > 0) {
      layered = {
        backgroundImage: bgImages.join(", "),
        backgroundSize: bgSizes.join(", "),
        backgroundPosition: bgPositions.join(", "),
        backgroundRepeat: bgRepeats.join(", "),
        backgroundBlendMode: blendModes.some((b) => b !== "normal") ? blendModes.join(", ") : undefined,
      };
    }
  }

  return {
    visibleFills: visible,
    solidFill,
    solidColor,
    gradientFill,
    gradientStyle,
    imageFill,
    imageSrc,
    imageFit,
    imageRepeat,
    hasMultipleFills: visible.length > 1,
    layered,
  };
}

/** Paint -> CSS background value (or colour value for text/strokes). */
export function paintCss(paint, tokens, assets) {
  if (!paint || paint.visible === false || paint.hidden === true) return undefined;
  switch (paint.kind) {
    case "solid":
      return cssColor(paint.color, paint.alpha);
    case "token": {
      const ref = tokenVarRef(tokens, paint.tokenId);
      if (ref) return ref;
      const v = resolveTokenValue(tokens, paint.tokenId);
      if (typeof v === "string") return v;
      if (paint.color) return cssColor(paint.color, paint.alpha);
      return undefined;
    }
    case "gradient":
      return gradientCss(paint);
    case "image": {
      const url = assets?.[paint.assetId] || paint.url || (paint.fileName ? `./${paint.fileName}` : undefined);
      return url ? `url('${url}')` : undefined;
    }
    default:
      if (paint.color) return cssColor(paint.color, paint.alpha);
      return undefined;
  }
}

/** Paint -> a single colour (gradients degrade to their first stop). */
export function paintColorCss(paint, tokens) {
  if (!paint || paint.visible === false || paint.hidden === true) return undefined;
  if (paint.kind === "gradient") {
    const first = paint.stops?.[0];
    return first ? (cssColor(first.color, first.alpha) || first.color) : undefined;
  }
  return paintCss(paint, tokens) || (paint.color ? cssColor(paint.color, paint.alpha) : undefined);
}

const FILTER_DEFS = [
  ["blur", "blur", "px", 0],
  ["brightness", "brightness", "%", 100],
  ["contrast", "contrast", "%", 100],
  ["grayscale", "grayscale", "%", 0],
  ["hueRotate", "hue-rotate", "deg", 0],
  ["invert", "invert", "%", 0],
  ["saturate", "saturate", "%", 100],
  ["sepia", "sepia", "%", 0],
];

function filterCss(filters) {
  if (!filters) return undefined;
  const parts = [];
  for (const [key, fn, unit, def] of FILTER_DEFS) {
    const v = filters[key];
    if (v != null && v !== def) parts.push(`${fn}(${v}${unit})`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

function shadowCss(shadows, innerShadows) {
  const one = (s, inset) =>
    `${inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${cssColor(s.color, s.alpha)}`;
  const parts = [
    ...(shadows ?? []).filter((s) => s && !s.hidden && s.visible !== false).map((s) => one(s, false)),
    ...(innerShadows ?? []).filter((s) => s && !s.hidden && s.visible !== false).map((s) => one(s, true)),
  ];
  return parts.length ? parts.join(", ") : undefined;
}

function radiusCss(radius, tokens) {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  if (typeof radius === "object" && typeof radius.tokenId === "string") {
    const ref = tokenVarRef(tokens, radius.tokenId);
    if (ref) return ref;
    const v = resolveTokenValue(tokens, radius.tokenId);
    if (v != null) return typeof v === "number" ? `${v}px` : v;
    if (radius.value != null) return `${radius.value}px`;
  }
  if (typeof radius === "object" && (radius.tl != null || radius.tr != null || radius.br != null || radius.bl != null)) {
    return `${radius.tl ?? 0}px ${radius.tr ?? 0}px ${radius.br ?? 0}px ${radius.bl ?? 0}px`;
  }
  return undefined;
}

function isTokenRef(v) {
  return v != null && typeof v === "object" && typeof v.tokenId === "string";
}

/** `number | {tokenId}` -> CSS length ("24px" or "var(--…)"). */
function numericCss(v, tokens) {
  if (typeof v === "number") return `${v}px`;
  if (isTokenRef(v)) return tokenVarRef(tokens, v.tokenId);
  return undefined;
}

/** Sizing -> CSS length for the freeform/absolute context. */
function sizingCss(sizing, tokens) {
  if (!sizing) return undefined;
  switch (sizing.kind) {
    case "fixed":
      return `${sizing.px}px`;
    case "relative":
      return `${sizing.pct}%`;
    case "token":
      return tokenVarRef(tokens, sizing.tokenId);
    case "fill":
      return "100%";
    case "fit":
      return "auto";
    default:
      return undefined;
  }
}

/**
 * Shader layer (M5) -> a static CSS approximation: the node's four
 * colours as radial-gradient washes at the shader anchors' corner
 * positions, over a base of the first colour. The live node is a WebGL
 * mesh gradient (warped, grained); generated code can't reproduce that,
 * so nodeToCss flags the substitution with a comment and this is the
 * closest static read of the same four colours. Positions are the
 * fragment anchors flipped to CSS's top-left origin. (Mirrored locally
 * like the other helpers — this module stays import-free.)
 */
export function shaderBackgroundCss(shader) {
  const raw = Array.isArray(shader?.colors) ? shader.colors : [];
  const c = [0, 1, 2, 3].map((i) =>
    typeof raw[i] === "string" && raw[i] !== "" ? raw[i] : "#000000",
  );
  return {
    base: c[0],
    image: [
      `radial-gradient(circle at 10% 88%, ${c[0]} 0%, transparent 70%)`,
      `radial-gradient(circle at 90% 82%, ${c[1]} 0%, transparent 70%)`,
      `radial-gradient(circle at 84% 12%, ${c[2]} 0%, transparent 70%)`,
      `radial-gradient(circle at 16% 18%, ${c[3]} 0%, transparent 70%)`,
    ].join(", "),
  };
}

const JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
};
const ALIGN = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

// ---------------------------------------------------------------------------
// Declaration builder — the shared core for CSS + React output
// ---------------------------------------------------------------------------

/**
 * Ordered [property, value] CSS declarations for one node.
 * ctx: { isRoot, parentLayout (null | layout), isFirstFill }
 */
export function nodeDecls(node, doc, ctx = {}) {
  const tokens = doc.tokens ?? [];
  const style = node.style ?? {};
  const d = [];
  const push = (prop, value) => {
    if (value != null && value !== "") d.push([prop, value]);
  };

  const parentFlex = ctx.parentLayout?.mode === "flex" ? ctx.parentLayout : null;
  const inFlow = parentFlex && !node.position?.absolute;

  // -- positioning / sizing -------------------------------------------------
  if (ctx.isRoot) {
    push("position", "relative");
  } else if (inFlow) {
    if (node.type === "frame" || (node.childIds && node.childIds.length > 0)) {
      push("position", "relative");
    }
    // Main/cross sizing is expressed through flex (see below); fixed cross
    // sizes still land as width/height.
    const row = parentFlex.direction === "row";
    const mainAxis = row ? "w" : "h";
    const crossAxis = row ? "h" : "w";
    const main = node.size?.[mainAxis];
    const cross = node.size?.[crossAxis];
    switch (main?.kind) {
      case "fixed":
        push("flex", `0 0 ${main.px}px`);
        break;
      case "token":
        push("flex", `0 0 ${tokenVarRef(tokens, main.tokenId) ?? "0px"}`);
        break;
      case "relative":
        push("flex", `0 0 ${main.pct}%`);
        break;
      case "fill":
        // Spec rule: first Fill takes the remainder, later Fills get 0.
        push("flex", ctx.isFirstFill ? "1 1 0px" : "0 0 0px");
        break;
      case "fit":
        push("flex", "0 1 auto");
        break;
    }
    switch (cross?.kind) {
      case "fixed":
        push(crossAxis === "w" ? "width" : "height", `${cross.px}px`);
        break;
      case "token":
        push(
          crossAxis === "w" ? "width" : "height",
          tokenVarRef(tokens, cross.tokenId),
        );
        break;
      case "relative":
        push(crossAxis === "w" ? "width" : "height", `${cross.pct}%`);
        break;
      case "fill":
        push("align-self", "stretch");
        break;
    }
  } else {
    push("position", "absolute");
    push("left", `${node.position?.x ?? 0}px`);
    push("top", `${node.position?.y ?? 0}px`);
    push("width", sizingCss(node.size?.w, tokens));
    push("height", sizingCss(node.size?.h, tokens));
  }

  if (ctx.isRoot) {
    push("width", sizingCss(node.size?.w, tokens));
    push("height", sizingCss(node.size?.h, tokens));
  }

  // -- flex container ---------------------------------------------------------
  if (node.type === "frame" && node.layout?.mode === "flex") {
    const l = node.layout;
    const base = l.direction === "row" ? "row" : "column";
    push("display", "flex");
    push("flex-direction", l.reverse ? `${base}-reverse` : base);
    if (l.wrap) push("flex-wrap", "wrap");
    push("gap", numericCss(l.gap, tokens));
    push("justify-content", JUSTIFY[l.alignMain] ?? "flex-start");
    push("align-items", ALIGN[l.alignCross] ?? "flex-start");
    push("box-sizing", "border-box");
  }

  // -- grid container ---------------------------------------------------------
  if (node.type === "frame" && node.layout?.mode === "grid") {
    const l = node.layout;
    push("display", l.display === "inline-grid" ? "inline-grid" : "grid");
    if (l.columns) push("grid-template-columns", l.columns);
    if (l.rows && l.rows !== "auto") push("grid-template-rows", l.rows);
    if (l.autoFlow && l.autoFlow !== "row") push("grid-auto-flow", l.autoFlow);
    if (l.autoColumns && l.autoColumns !== "auto") push("grid-auto-columns", l.autoColumns);
    if (l.autoRows && l.autoRows !== "auto") push("grid-auto-rows", l.autoRows);
    if (l.gap) push("gap", numericCss(l.gap, tokens));
    if (l.columnGap && l.columnGap !== l.gap) push("column-gap", numericCss(l.columnGap, tokens));
    if (l.rowGap && l.rowGap !== l.gap) push("row-gap", numericCss(l.rowGap, tokens));
    if (l.justifyItems && l.justifyItems !== "stretch") push("justify-items", l.justifyItems);
    if (l.alignItems && l.alignItems !== "stretch") push("align-items", l.alignItems);
    if (l.justifyContent && l.justifyContent !== "start") push("justify-content", l.justifyContent);
    if (l.alignContent && l.alignContent !== "start") push("align-content", l.alignContent);
    if (l.areas) push("grid-template-areas", l.areas);
    push("box-sizing", "border-box");
  }

  // -- grid item placement -----------------------------------------------------
  if (node.gridLayout) {
    const gl = node.gridLayout;
    if (gl.gridColumn) push("grid-column", gl.gridColumn);
    else if (gl.gridColumnStart || gl.gridColumnEnd) {
      push("grid-column", `${gl.gridColumnStart || "auto"} / ${gl.gridColumnEnd || "auto"}`);
    }
    if (gl.gridRow) push("grid-row", gl.gridRow);
    else if (gl.gridRowStart || gl.gridRowEnd) {
      push("grid-row", `${gl.gridRowStart || "auto"} / ${gl.gridRowEnd || "auto"}`);
    }
    if (gl.gridArea) push("grid-area", gl.gridArea);
    if (gl.justifySelf) push("justify-self", gl.justifySelf);
    if (gl.alignSelf) push("align-self", gl.alignSelf);
    if (typeof gl.order === "number") push("order", String(gl.order));
  }

  // -- padding ----------------------------------------------------------------
  const paddingLayout = node.layout?.padding ?? node.padding;
  if (paddingLayout) {
    const padTop = numericCss(paddingLayout?.t ?? paddingLayout?.top ?? paddingLayout?.v ?? paddingLayout?.y, tokens) ?? "0px";
    const padBottom = numericCss(paddingLayout?.b ?? paddingLayout?.bottom ?? paddingLayout?.v ?? paddingLayout?.y, tokens) ?? "0px";
    const padLeft = numericCss(paddingLayout?.l ?? paddingLayout?.left ?? paddingLayout?.h ?? paddingLayout?.x, tokens) ?? "0px";
    const padRight = numericCss(paddingLayout?.r ?? paddingLayout?.right ?? paddingLayout?.h ?? paddingLayout?.x, tokens) ?? "0px";

    if (padTop === padBottom && padLeft === padRight) {
      if (padTop !== "0px" || padLeft !== "0px") push("padding", `${padTop} ${padLeft}`);
    } else {
      push("padding", `${padTop} ${padRight} ${padBottom} ${padLeft}`);
    }
    push("box-sizing", "border-box");
  }

  // -- margin -----------------------------------------------------------------
  const marginLayout = node.layout?.margin ?? node.margin;
  if (marginLayout) {
    const marTop = numericCss(marginLayout?.t ?? marginLayout?.top ?? marginLayout?.v ?? marginLayout?.y, tokens) ?? "0px";
    const marBottom = numericCss(marginLayout?.b ?? marginLayout?.bottom ?? marginLayout?.v ?? marginLayout?.y, tokens) ?? "0px";
    const marLeft = numericCss(marginLayout?.l ?? marginLayout?.left ?? marginLayout?.h ?? marginLayout?.x, tokens) ?? "0px";
    const marRight = numericCss(marginLayout?.r ?? marginLayout?.right ?? marginLayout?.h ?? marginLayout?.x, tokens) ?? "0px";
    if (marTop === marBottom && marLeft === marRight) {
      if (marTop === marLeft) {
        if (marTop !== "0px") push("margin", marTop);
      } else {
        if (marTop !== "0px" || marLeft !== "0px") push("margin", `${marTop} ${marLeft}`);
      }
    } else {
      push("margin", `${marTop} ${marRight} ${marBottom} ${marLeft}`);
    }
  }

  // -- paint ------------------------------------------------------------------
  const fillInfo = getFillInfo(node, doc);
  if (node.type === "shader") {
    // M5: the WebGL gradient approximated as CSS gradients (see
    // shaderBackgroundCss). The node's own style.fill stays unused.
    const bg = shaderBackgroundCss(node.shader);
    push("background-color", bg.base);
    push("background-image", bg.image);
  } else if (node.type === "text") {
    const fill = getPrimaryVisibleFill(node);
    if (fill) push("color", paintColorCss(fill, tokens));
  } else {
    // Multi-fill and layered fill support (solid + image / gradient / tokens)
    if (fillInfo.solidColor) {
      if (fillInfo.imageSrc || fillInfo.layered) {
        push("background-color", fillInfo.solidColor);
      } else {
        push("background", fillInfo.solidColor);
      }
    }
    if (fillInfo.layered) {
      push("background-image", fillInfo.layered.backgroundImage);
      push("background-size", fillInfo.layered.backgroundSize);
      push("background-position", fillInfo.layered.backgroundPosition);
      push("background-repeat", fillInfo.layered.backgroundRepeat);
      if (fillInfo.layered.backgroundBlendMode) {
        push("background-blend-mode", fillInfo.layered.backgroundBlendMode);
      }
    } else {
      if (fillInfo.solidColor) {
        if (fillInfo.imageSrc) {
          push("background-color", fillInfo.solidColor);
        } else {
          push("background", fillInfo.solidColor);
        }
      }
      if (fillInfo.gradientStyle) {
        push("background-image", fillInfo.gradientStyle);
      }
      if (fillInfo.imageSrc) {
        push("background-image", `url('${fillInfo.imageSrc}')`);
        push("background-size", fillInfo.imageFit);
        push("background-position", "center");
        push("background-repeat", fillInfo.imageRepeat);
      }
      const blendFill = fillInfo.visibleFills.find((f) => f.blendMode && f.blendMode !== "normal");
      if (blendFill) {
        push("background-blend-mode", blendFill.blendMode);
      }
    }
  }

  if (style.outline && !style.outline.hidden && style.outline.visible !== false) {
    const c = paintColorCss(style.outline.paint, tokens) || (style.outline.paint?.color ? cssColor(style.outline.paint.color, style.outline.paint.alpha) : undefined);
    const ost = style.outline.style || "solid";
    if (c) {
      push("outline", `${style.outline.width ?? 1}px ${ost} ${c}`);
      if (style.outline.offset) push("outline-offset", `${style.outline.offset}px`);
    }
  }
  const bordersList = style.borders ?? (style.border ? [style.border] : []);
  for (const b of bordersList) {
    if (b.hidden || b.visible === false) continue;
    const c = paintColorCss(b.paint, tokens) || (b.paint?.color ? cssColor(b.paint.color, b.paint.alpha) : undefined);
    const bStyle = b.style || style.borderStyle || "solid";
    const width = b.width != null ? b.width : 1;
    if (c) {
      const v = `${width}px ${bStyle} ${c}`;
      push(b.side === "all" || !b.side ? "border" : `border-${b.side}`, v);
    }
  }
  push("border-radius", radiusCss(style.radius, tokens));
  const isDrop = style.shadowType === "drop" || node.type === "text";
  if (isDrop && style.shadow?.length) {
    const dropParts = (style.shadow ?? [])
      .filter((sh) => !sh.hidden && sh.visible !== false)
      .map((sh) => {
        const c = paintColorCss({ kind: "solid", color: sh.color, alpha: sh.alpha ?? 1 }, tokens) || sh.color || "rgba(0,0,0,0.2)";
        return `drop-shadow(${sh.x ?? 0}px ${sh.y ?? 2}px ${sh.blur ?? 3}px ${c})`;
      });
    const filter = filterCss(style.filters);
    const combinedFilter = [filter, ...dropParts].filter(Boolean).join(" ");
    if (combinedFilter) push("filter", combinedFilter);
    if (style.innerShadow?.length) {
      push("box-shadow", shadowCss([], style.innerShadow));
    }
  } else {
    push("box-shadow", shadowCss(style.shadow, style.innerShadow));
    push("filter", filterCss(style.filters));
  }
  push("backdrop-filter", filterCss(style.backdropFilters));
  if (style.opacity != null && style.opacity !== 1) {
    push("opacity", String(style.opacity));
  }
  if (style.blendMode && style.blendMode !== "normal") {
    push("mix-blend-mode", style.blendMode);
  }
  if (node.rotation) push("transform", `rotate(${node.rotation}deg)`);

  // -- text -------------------------------------------------------------------
  if (node.type === "text" && node.text) {
    const t = node.text;
    const metrics = getEffectiveTextMetrics(node);
    if (metrics.fontFamily) {
      push("font-family", metrics.fontFamily.includes(" ") ? `"${metrics.fontFamily}", sans-serif` : `${metrics.fontFamily}, sans-serif`);
    }
    push("font-size", `${metrics.fontSize}px`);
    push("font-weight", String(t.fontWeight ?? 400));
    push("line-height", String(metrics.lineHeight));
    if (t.letterSpacing) push("letter-spacing", `${t.letterSpacing}px`);
    push("text-align", metrics.align);
    if (t.truncation) {
      push("white-space", "nowrap");
      push("overflow", "hidden");
      push("text-overflow", "ellipsis");
    } else if (t.wrap === "none") {
      push("white-space", "nowrap");
    } else if (t.wrap === "break-word") {
      push("white-space", "pre-wrap");
      push("word-break", "break-word");
    } else {
      push("white-space", "pre-wrap");
    }

    const ul = t.underline;
    if (ul && !ul.hidden && ul.visible !== false) {
      const ulColor = paintColorCss(ul.paint, tokens) || (ul.paint?.color ? cssColor(ul.paint.color, ul.paint.alpha) : "currentColor");
      push("text-decoration-line", "underline");
      push("text-decoration-style", ul.style || "solid");
      push("text-decoration-color", ulColor);
      push("text-decoration-thickness", `${ul.width ?? 1}px`);
      if (ul.offset && ul.offset !== "Auto" && ul.offset !== "auto") {
        push("text-underline-offset", typeof ul.offset === "number" ? `${ul.offset}px` : ul.offset);
      }
    } else if (t.textDecoration) {
      push("text-decoration", t.textDecoration);
    }
    if (t.stroke && !t.stroke.hidden && t.stroke.visible !== false) {
      const strokeColor = paintColorCss(t.stroke.paint, tokens) || (t.stroke.paint?.color ? cssColor(t.stroke.paint.color, t.stroke.paint.alpha) : "#000000");
      push("-webkit-text-stroke", `${t.stroke.width ?? 1}px ${strokeColor}`);
    }
  }

  // -- custom CSS (Other styles section) --------------------------------------
  if (style.customCss && typeof style.customCss === "object") {
    for (const [prop, raw] of Object.entries(style.customCss)) {
      const isEnabled = typeof raw === "object" && raw !== null ? raw.enabled !== false : Boolean(raw);
      const val = typeof raw === "object" && raw !== null ? raw.value : raw;
      if (isEnabled && val != null && val !== "") {
        push(prop, val);
      }
    }
  }

  return d;
}

/** Child contexts for a node's children (flex first-Fill bookkeeping). */
function childContexts(node, doc) {
  const map = new Map();
  const kids = (node.childIds ?? [])
    .map((id) => doc.nodes[id])
    .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);
  if (node.layout?.mode === "flex") {
    const mainAxis = node.layout.direction === "row" ? "w" : "h";
    const firstFill = kids.find(
      (c) => !c.position?.absolute && c.size?.[mainAxis]?.kind === "fill",
    );
    for (const c of kids) {
      map.set(c.id, {
        isRoot: false,
        parentLayout: node.layout,
        isFirstFill: c.id === firstFill?.id,
      });
    }
  } else {
    for (const c of kids) map.set(c.id, { isRoot: false, parentLayout: null });
  }
  return map;
}

/** Unique class names per subtree walk (slug collisions get -2, -3…). */
function classNamer() {
  const used = new Map();
  return (node) => {
    const base = slugify(node.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/**
 * The file's tokens as a `:root` block of CSS variables ("" when empty).
 */
export function tokensCssBlock(doc) {
  const tokens = (doc?.tokens ?? []).filter((t) => t && t.name);
  const lines = tokens.map(
    (t) => `  ${tokenVarName(t)}: ${tokenCssValue(t, tokens)};`,
  );
  // Ensure standard container tokens exist as fallback if referenced
  const standardContainers = [
    ["--container-320", "320px"],
    ["--container-480", "480px"],
    ["--container-640", "640px"],
    ["--container-768", "768px"],
    ["--container-1024", "1024px"],
    ["--container-1280", "1280px"],
    ["--container-1536", "1536px"],
  ];
  for (const [varName, defaultVal] of standardContainers) {
    if (!lines.some((l) => l.trim().startsWith(varName + ":"))) {
      lines.push(`  ${varName}: ${defaultVal};`);
    }
  }
  if (lines.length === 0) return "";
  return `:root {\n${lines.join("\n")}\n}`;
}

/**
 * nodeToCss(rootNode, doc) -> stylesheet text: the `:root` token block
 * plus one rule per node in the subtree (pre-order).
 */
export function nodeToCss(root, doc) {
  const parts = [];
  const rootBlock = tokensCssBlock(doc);
  if (rootBlock) parts.push(rootBlock);
  const nameClass = classNamer();
  const walk = (node, ctx) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return;
    const cls = nameClass(node);
    const decls = nodeDecls(node, doc, ctx);
    const body = decls.map(([p, v]) => `  ${p}: ${v};`).join("\n");
    // M5: say out loud that a shader layer became plain gradients.
    const note =
      node.type === "shader"
        ? "  /* shader layer approximated as gradients */\n"
        : "";
    parts.push(`.${cls} {\n${note}${body}\n}`);
    const ctxs = childContexts(node, doc);
    for (const id of node.childIds ?? []) {
      const child = doc.nodes[id];
      if (child && !child.hidden && child.visible !== false && child.style?.opacity !== 0) {
        walk(child, ctxs.get(id));
      }
    }
  };
  walk(root, { isRoot: true, parentLayout: null });
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

const CAMEL = {
  "flex-direction": "flexDirection",
  "flex-wrap": "flexWrap",
  "justify-content": "justifyContent",
  "align-items": "alignItems",
  "align-self": "alignSelf",
  "background-color": "backgroundColor",
  "background-image": "backgroundImage",
  "background-size": "backgroundSize",
  "background-position": "backgroundPosition",
  "background-repeat": "backgroundRepeat",
  "border-radius": "borderRadius",
  "border-top": "borderTop",
  "border-right": "borderRight",
  "border-bottom": "borderBottom",
  "border-left": "borderLeft",
  "box-shadow": "boxShadow",
  "box-sizing": "boxSizing",
  "backdrop-filter": "backdropFilter",
  "mix-blend-mode": "mixBlendMode",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "line-height": "lineHeight",
  "letter-spacing": "letterSpacing",
  "text-align": "textAlign",
  "white-space": "whiteSpace",
  "border": "border",
  "outline": "outline",
  "outline-offset": "outlineOffset",
  "-webkit-text-stroke": "WebkitTextStroke",
  "text-decoration-line": "textDecorationLine",
  "text-decoration-style": "textDecorationStyle",
  "text-decoration-color": "textDecorationColor",
  "text-decoration-thickness": "textDecorationThickness",
  "text-underline-offset": "textUnderlineOffset",
};

function styleObjectLiteral(decls, indent) {
  if (decls.length === 0) return "{}";
  const numeric = new Set(["opacity", "font-weight", "line-height"]);
  const lines = decls.map(([p, v]) => {
    let key;
    if (p.startsWith("--")) {
      key = JSON.stringify(p);
    } else if (CAMEL[p]) {
      key = CAMEL[p];
    } else if (p.startsWith("-ms-")) {
      key = "ms" + p.slice(4).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    } else if (p.startsWith("-webkit-")) {
      const rest = p.slice(8).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      key = "Webkit" + (rest.charAt(0).toUpperCase() + rest.slice(1));
    } else if (p.startsWith("-moz-")) {
      const rest = p.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      key = "Moz" + (rest.charAt(0).toUpperCase() + rest.slice(1));
    } else {
      key = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }
    const val =
      numeric.has(p) && /^-?[\d.]+$/.test(v) ? v : JSON.stringify(v);
    return `${indent}  ${key}: ${val},`;
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/**
 * Recursively renders SVG paths, polygons, and groups preserving fillRule,
 * clipRule, stroke, fill, opacity, and transforms.
 */
function renderSvgElements(containerNode, doc, indent, isJsx = true) {
  const childNodes = (containerNode.childIds ?? [])
    .map((id) => doc.nodes?.[id])
    .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);

  const lines = [];

  for (const child of childNodes) {
    if (child.type === "group") {
      const groupInner = renderSvgElements(child, doc, `${indent}  `, isJsx);
      const transformAttr = child.transform ? ` transform="${child.transform}"` : "";
      const opacityAttr = child.style?.opacity !== undefined && child.style.opacity < 1 ? ` opacity="${child.style.opacity}"` : "";
      const fillRuleAttr = child.fillRule && child.fillRule !== "nonzero"
        ? (isJsx ? ` fillRule="${child.fillRule}"` : ` fill-rule="${child.fillRule}"`)
        : "";
      const clipRuleAttr = child.clipRule
        ? (isJsx ? ` clipRule="${child.clipRule}"` : ` clip-rule="${child.clipRule}"`)
        : "";
      if (groupInner) {
        lines.push(`${indent}<g${transformAttr}${opacityAttr}${fillRuleAttr}${clipRuleAttr}>\n${groupInner}\n${indent}</g>`);
      }
    } else if (child.type === "path" || child.type === "polygon") {
      const fill = getPrimaryVisibleFill(child);
      const fillColor = fill ? (paintColorCss(fill, doc.tokens) || child.fill || "#18181B") : "none";
      const strokePaint = child.style?.stroke;
      const hasStroke = strokePaint && !strokePaint.hidden && strokePaint.visible !== false;
      const strokeColor = hasStroke ? (paintColorCss(strokePaint.paint || strokePaint, doc.tokens) || child.stroke || "currentColor") : "none";
      const strokeW = hasStroke ? (strokePaint.width ?? child.strokeWidth ?? 1.3) : 0;
      const strokeWAttr = isJsx ? `strokeWidth="${strokeW}"` : `stroke-width="${strokeW}"`;
      const capAttr = isJsx ? `strokeLinecap="${child.strokeLinecap || "round"}"` : `stroke-linecap="${child.strokeLinecap || "round"}"`;
      const joinAttr = isJsx ? `strokeLinejoin="${child.strokeLinejoin || "round"}"` : `stroke-linejoin="${child.strokeLinejoin || "round"}"`;
      const fillRuleAttr = child.fillRule && child.fillRule !== "nonzero"
        ? (isJsx ? ` fillRule="${child.fillRule}"` : ` fill-rule="${child.fillRule}"`)
        : "";
      const clipRuleAttr = child.clipRule
        ? (isJsx ? ` clipRule="${child.clipRule}"` : ` clip-rule="${child.clipRule}"`)
        : "";
      const transformAttr = child.transform ? ` transform="${child.transform}"` : "";
      const opacityAttr = child.style?.opacity !== undefined && child.style.opacity < 1 ? ` opacity="${child.style.opacity}"` : "";

      lines.push(`${indent}<path d="${child.d || ""}" fill="${fillColor}" stroke="${strokeColor}" ${strokeWAttr} ${capAttr} ${joinAttr}${fillRuleAttr}${clipRuleAttr}${transformAttr}${opacityAttr} />`);
    }
  }

  return lines.join("\n");
}

/**
 * nodeToReact(rootNode, doc) -> a React component (JSX string) using
 * inline style objects.
 */
export function nodeToReact(root, doc) {
  const render = (node, ctx, depth) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return "";
    const indent = "  ".repeat(depth);
    const decls = nodeDecls(node, doc, ctx);
    const style = styleObjectLiteral(decls, `${indent}  `);
    const ctxs = childContexts(node, doc);
    const kids = (node.childIds ?? [])
      .map((id) => doc.nodes[id])
      .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);
    if (node.type === "text") {
      const tag = getTextTag(node);
      if (node.text?.html) {
        return `${indent}<${tag} style={${style}} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanAndNormalizeHtml(node.text.html))} }} />`;
      }
      const content = String(node.text?.content ?? "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `${indent}<${tag} style={${style}}>${content}</${tag}>`;
    }
    if (node.type === "svg") {
      const pathElements = renderSvgElements(node, doc, `${indent}  `, true);
      const w = node.size?.w?.px || 16;
      const h = node.size?.h?.px || 16;
      const vb = node.viewBox || `0 0 ${w} ${h}`;
      return `${indent}<svg width="${w}" height="${h}" viewBox="${vb}" fill="none">\n${pathElements}\n${indent}</svg>`;
    }
    if (kids.length === 0) {
      return `${indent}<div style={${style}} />`;
    }
    const inner = kids
      .map((c) => render(c, ctxs.get(c.id), depth + 1))
      .filter(Boolean)
      .join("\n");
    return `${indent}<div style={${style}}>\n${inner}\n${indent}</div>`;
  };
  const body = render(root, { isRoot: true, parentLayout: null }, 2);
  return `export default function ${pascalCase(root.name)}() {\n  return (\n${body}\n  );\n}`;
}

// ---------------------------------------------------------------------------
// Tailwind
// ---------------------------------------------------------------------------

/** Arbitrary-value-safe: Tailwind arbitrary values use _ for spaces. */
function arb(v) {
  return `[${String(v).replace(/\s+/g, "_")}]`;
}

const WEIGHT_CLASS = {
  400: "font-normal",
  500: "font-medium",
  600: "font-semibold",
  700: "font-bold",
};

function tailwindClasses(node, doc, ctx) {
  const tokens = doc.tokens ?? [];
  const style = node.style ?? {};
  const cls = [];
  const parentFlex = ctx.parentLayout?.mode === "flex" ? ctx.parentLayout : null;
  const inFlow = parentFlex && !node.position?.absolute;

  if (ctx.isRoot) {
    cls.push("relative");
  } else if (!inFlow) {
    cls.push(
      "absolute",
      `left-${arb(`${node.position?.x ?? 0}px`)}`,
      `top-${arb(`${node.position?.y ?? 0}px`)}`,
    );
  } else if (node.type === "frame" || (node.childIds && node.childIds.length > 0)) {
    cls.push("relative");
  }

  const sizeClass = (axis, sizing) => {
    if (!sizing) return null;
    const p = axis === "w" ? "w" : "h";
    switch (sizing.kind) {
      case "fixed":
        return `${p}-${arb(`${sizing.px}px`)}`;
      case "relative":
        return `${p}-${arb(`${sizing.pct}%`)}`;
      case "token": {
        const ref = tokenVarRef(tokens, sizing.tokenId);
        return ref ? `${p}-${arb(ref)}` : null;
      }
      case "fill":
        return `${p}-full`;
      default:
        return null;
    }
  };

  if (inFlow) {
    const row = parentFlex.direction === "row";
    const main = node.size?.[row ? "w" : "h"];
    const cross = node.size?.[row ? "h" : "w"];
    switch (main?.kind) {
      case "fixed":
        if (node.type === "text" && !row && node.text?.fontSize && main.px < node.text.fontSize) {
          cls.push("basis-auto", "shrink-0");
        } else {
          cls.push(`basis-${arb(`${main.px}px`)}`, "shrink-0");
          cls.push(row ? `w-${arb(`${main.px}px`)}` : `h-${arb(`${main.px}px`)}`);
        }
        break;
      case "relative":
        cls.push(`basis-${arb(`${main.pct}%`)}`, "shrink-0");
        break;
      case "token": {
        const ref = tokenVarRef(tokens, main.tokenId);
        if (ref) cls.push(`basis-${arb(ref)}`, "shrink-0");
        break;
      }
      case "fill":
        cls.push(ctx.isFirstFill ? "flex-1 basis-0" : "basis-0 shrink-0");
        break;
    }
    if (cross?.kind === "fill") cls.push("self-stretch");
    else {
      const c = sizeClass(row ? "h" : "w", cross);
      if (c) cls.push(c);
    }
  } else {
    const w = sizeClass("w", node.size?.w);
    const h = sizeClass("h", node.size?.h);
    if (w) cls.push(w);
    if (h) cls.push(h);
  }

  if (node.type === "frame" && node.layout?.mode === "flex") {
    const l = node.layout;
    cls.push("flex", l.direction === "row" ? (l.reverse ? "flex-row-reverse" : "flex-row") : l.reverse ? "flex-col-reverse" : "flex-col");
    if (l.wrap) cls.push("flex-wrap");
    const gap = numericCss(l.gap, tokens);
    if (gap) cls.push(`gap-${arb(gap)}`);
    cls.push(
      { start: "justify-start", center: "justify-center", end: "justify-end", "space-between": "justify-between" }[l.alignMain] ?? "justify-start",
      { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" }[l.alignCross] ?? "items-start",
    );
    cls.push("box-border");
  }

  // Padding classes
  const paddingLayout = node.layout?.padding ?? node.padding;
  if (paddingLayout) {
    const padTop = numericCss(paddingLayout?.t ?? paddingLayout?.top ?? paddingLayout?.v ?? paddingLayout?.y, tokens);
    const padBottom = numericCss(paddingLayout?.b ?? paddingLayout?.bottom ?? paddingLayout?.v ?? paddingLayout?.y, tokens);
    const padLeft = numericCss(paddingLayout?.l ?? paddingLayout?.left ?? paddingLayout?.h ?? paddingLayout?.x, tokens);
    const padRight = numericCss(paddingLayout?.r ?? paddingLayout?.right ?? paddingLayout?.h ?? paddingLayout?.x, tokens);

    if (padLeft && padLeft === padRight && padLeft !== "0px") {
      cls.push(`px-${arb(padLeft)}`);
    } else {
      if (padLeft && padLeft !== "0px") cls.push(`pl-${arb(padLeft)}`);
      if (padRight && padRight !== "0px") cls.push(`pr-${arb(padRight)}`);
    }

    if (padTop && padTop === padBottom && padTop !== "0px") {
      cls.push(`py-${arb(padTop)}`);
    } else {
      if (padTop && padTop !== "0px") cls.push(`pt-${arb(padTop)}`);
      if (padBottom && padBottom !== "0px") cls.push(`pb-${arb(padBottom)}`);
    }
  }

  // Margin classes
  const marginLayout = node.layout?.margin ?? node.margin;
  if (marginLayout) {
    const marTop = numericCss(marginLayout?.t ?? marginLayout?.top ?? marginLayout?.v ?? marginLayout?.y, tokens);
    const marBottom = numericCss(marginLayout?.b ?? marginLayout?.bottom ?? marginLayout?.v ?? marginLayout?.y, tokens);
    const marLeft = numericCss(marginLayout?.l ?? marginLayout?.left ?? marginLayout?.h ?? marginLayout?.x, tokens);
    const marRight = numericCss(marginLayout?.r ?? marginLayout?.right ?? marginLayout?.h ?? marginLayout?.x, tokens);

    if (marTop && marTop === marBottom && marLeft && marLeft === marRight && marTop === marLeft && marTop !== "0px") {
      cls.push(`m-${arb(marTop)}`);
    } else {
      if (marLeft && marLeft === marRight && marLeft && marLeft !== "0px") {
        cls.push(`mx-${arb(marLeft)}`);
      } else {
        if (marLeft && marLeft !== "0px") cls.push(`ml-${arb(marLeft)}`);
        if (marRight && marRight !== "0px") cls.push(`mr-${arb(marRight)}`);
      }
      if (marTop && marTop === marBottom && marTop && marTop !== "0px") {
        cls.push(`my-${arb(marTop)}`);
      } else {
        if (marTop && marTop !== "0px") cls.push(`mt-${arb(marTop)}`);
        if (marBottom && marBottom !== "0px") cls.push(`mb-${arb(marBottom)}`);
      }
    }
  }

  if (node.type === "shader") {
    // M5: same gradient approximation as the CSS output.
    const bg = shaderBackgroundCss(node.shader);
    cls.push(`bg-${arb(bg.base)}`);
    cls.push(`[background-image:${bg.image.replace(/\s+/g, "_")}]`);
  }

  const fillInfo = getFillInfo(node, doc);
  if (node.type === "text") {
    const fill = getPrimaryVisibleFill(node);
    if (fill) {
      const c = paintColorCss(fill, tokens);
      if (c) cls.push(`text-${arb(c)}`);
    }
  } else if (node.type === "shader") {
    // M5: same gradient approximation as the CSS output.
    const bg = shaderBackgroundCss(node.shader);
    cls.push(`bg-${arb(bg.base)}`);
    cls.push(`[background-image:${bg.image.replace(/\s+/g, "_")}]`);
  } else {
    if (fillInfo.solidColor) {
      cls.push(`bg-${arb(fillInfo.solidColor)}`);
    }
    if (fillInfo.gradientStyle) {
      cls.push(`bg-${arb(fillInfo.gradientStyle)}`);
    }
    if (fillInfo.imageSrc || node.type === "image") {
      cls.push(fillInfo.imageFit === "contain" ? "bg-contain" : fillInfo.imageFit === "100% 100%" ? "bg-[length:100%_100%]" : "bg-cover");
      cls.push("bg-center");
      cls.push(fillInfo.imageRepeat === "repeat" ? "bg-repeat" : "bg-no-repeat");
    }
  }

  const radius = radiusCss(style.radius, tokens);
  if (radius) cls.push(`rounded-${arb(radius)}`);

  // Borders
  const bordersList = style.borders ?? (style.border ? [style.border] : []);
  for (const b of bordersList) {
    if (b.hidden || b.visible === false) continue;
    const c = paintColorCss(b.paint, tokens) || (b.paint?.color ? cssColor(b.paint.color, b.paint.alpha) : undefined);
    const bStyle = b.style || style.borderStyle || "solid";
    const width = b.width != null ? b.width : 1;
    if (c) {
      if (b.side === "all" || !b.side) {
        cls.push(`border-[${width}px]`);
        cls.push(`border-${bStyle}`);
        cls.push(`border-${arb(c)}`);
      } else {
        const sideMap = { top: "t", bottom: "b", left: "l", right: "r" };
        const s = sideMap[b.side] || "t";
        cls.push(`border-${s}-[${width}px]`);
        cls.push(`border-${bStyle}`);
        cls.push(`border-${s}-${arb(c)}`);
      }
    }
  }

  // Outline
  if (style.outline && !style.outline.hidden && style.outline.visible !== false) {
    const c = paintColorCss(style.outline.paint, tokens) || (style.outline.paint?.color ? cssColor(style.outline.paint.color, style.outline.paint.alpha) : undefined);
    const ost = style.outline.style || "solid";
    const width = style.outline.width != null ? style.outline.width : 1;
    if (c) {
      cls.push(`outline-[${width}px]`);
      cls.push(`outline-${ost}`);
      cls.push(`outline-${arb(c)}`);
      if (style.outline.offset) {
        cls.push(`outline-offset-[${style.outline.offset}px]`);
      }
    }
  }

  const isDrop = style.shadowType === "drop" || node.type === "text";
  if (isDrop && style.shadow?.length) {
    const drops = (style.shadow ?? []).filter((s) => !s.hidden && s.visible !== false);
    for (const sh of drops) {
      const c = paintColorCss({ kind: "solid", color: sh.color, alpha: sh.alpha ?? 1 }, tokens) || sh.color || "rgba(0,0,0,0.2)";
      const cClean = c.replace(/\s+/g, "_");
      cls.push(`drop-shadow-[${sh.x ?? 0}px_${sh.y ?? 2}px_${sh.blur ?? 3}px_${cClean}]`);
    }
    if (style.innerShadow?.length) {
      const inner = shadowCss([], style.innerShadow);
      if (inner) cls.push(`shadow-${arb(inner)}`);
    }
  } else {
    const shadow = shadowCss(style.shadow, style.innerShadow);
    if (shadow) cls.push(`shadow-${arb(shadow)}`);
  }
  if (style.opacity != null && style.opacity !== 1) {
    cls.push(`opacity-${arb(style.opacity)}`);
  }
  if (style.blendMode && style.blendMode !== "normal") {
    cls.push(`mix-blend-${style.blendMode}`);
  }
  if (node.rotation) cls.push(`rotate-${arb(`${node.rotation}deg`)}`);
  const filters = filterCss(style.filters);
  if (filters) cls.push(`[filter:${filters.replace(/\s+/g, "_")}]`);
  const backdrop = filterCss(style.backdropFilters);
  if (backdrop) cls.push(`[backdrop-filter:${backdrop.replace(/\s+/g, "_")}]`);

  if (node.type === "text" && node.text) {
    const t = node.text;
    const metrics = getEffectiveTextMetrics(node);
    if (metrics.fontFamily) {
      cls.push(`font-['${metrics.fontFamily.replace(/\s+/g, "_")}',_sans-serif]`);
    }
    cls.push(`text-${arb(`${metrics.fontSize}px`)}`);
    cls.push(WEIGHT_CLASS[t.fontWeight ?? 400] ?? `font-${arb(t.fontWeight ?? 400)}`);
    cls.push(`leading-${arb(metrics.lineHeight)}`);
    if (t.letterSpacing) cls.push(`tracking-${arb(`${t.letterSpacing}px`)}`);
    cls.push(`text-${metrics.align}`);
    if (t.truncation) {
      cls.push("truncate");
    } else if (t.wrap === "none") {
      cls.push("whitespace-nowrap");
    } else if (t.wrap === "break-word") {
      cls.push("whitespace-pre-wrap break-words");
    } else {
      cls.push("whitespace-pre-wrap");
    }

    const ul = t.underline;
    if (ul && !ul.hidden && ul.visible !== false) {
      cls.push("underline");
      if (ul.style && ul.style !== "solid") cls.push(`decoration-${ul.style}`);
      const ulColor = paintColorCss(ul.paint, tokens) || (ul.paint?.color ? cssColor(ul.paint.color, ul.paint.alpha) : undefined);
      if (ulColor) cls.push(`decoration-${arb(ulColor)}`);
      if (ul.width) cls.push(`decoration-[${ul.width}px]`);
      if (ul.offset && ul.offset !== "Auto" && ul.offset !== "auto") {
        cls.push(`underline-offset-[${typeof ul.offset === "number" ? `${ul.offset}px` : ul.offset}]`);
      }
    } else if (t.textDecoration === "underline") {
      cls.push("underline");
    } else if (t.textDecoration === "line-through") {
      cls.push("line-through");
    }
  }

  // Custom CSS (Other styles section)
  if (style.customCss && typeof style.customCss === "object") {
    for (const [prop, raw] of Object.entries(style.customCss)) {
      const isEnabled = typeof raw === "object" && raw !== null ? raw.enabled !== false : Boolean(raw);
      const val = typeof raw === "object" && raw !== null ? raw.value : raw;
      if (isEnabled && val != null && val !== "") {
        cls.push(`[${prop}:${val.replace(/\s+/g, "_")}]`);
      }
    }
  }

  return Array.from(new Set(cls.filter(Boolean))).join(" ");
}

/**
 * nodeToTailwind(rootNode, doc) -> a JSX snippet with utility +
 * arbitrary-value classes approximating the same subtree.
 */
export function nodeToTailwind(root, doc) {
  const render = (node, ctx, depth) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return "";
    const indent = "  ".repeat(depth);
    const classes = tailwindClasses(node, doc, ctx);
    const ctxs = childContexts(node, doc);
    const kids = (node.childIds ?? [])
      .map((id) => doc.nodes[id])
      .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);
    if (node.type === "text") {
      const tag = getTextTag(node);
      if (node.text?.html) {
        return `${indent}<${tag} className="${classes}" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanAndNormalizeHtml(node.text.html))} }} />`;
      }
      const content = String(node.text?.content ?? "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `${indent}<${tag} className="${classes}">${content}</${tag}>`;
    }
    if (node.type === "svg") {
      const pathElements = renderSvgElements(node, doc, `${indent}  `, true);
      const w = node.size?.w?.px || 16;
      const h = node.size?.h?.px || 16;
      const vb = node.viewBox || `0 0 ${w} ${h}`;
      return `${indent}<svg className="${classes}" width="${w}" height="${h}" viewBox="${vb}" fill="none">\n${pathElements}\n${indent}</svg>`;
    }

    const fillInfo = getFillInfo(node, doc);
    let styleProp = "";
    if (fillInfo.imageSrc) {
      styleProp = ` style={{ backgroundImage: "url('${fillInfo.imageSrc}')" }}`;
    }

    if (kids.length === 0) {
      return `${indent}<div className="${classes}"${styleProp} />`;
    }
    const inner = kids
      .map((c) => render(c, ctxs.get(c.id), depth + 1))
      .filter(Boolean)
      .join("\n");
    return `${indent}<div className="${classes}"${styleProp}>\n${inner}\n${indent}</div>`;
  };
  return render(root, { isRoot: true, parentLayout: null }, 0);
}

const WEB_SAFE_FONTS = new Set([
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "arial",
  "helvetica",
  "helvetica neue",
  "times new roman",
  "times",
  "georgia",
  "courier new",
  "courier",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "impact",
  "comic sans ms",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "inherit",
  "initial",
]);

const KNOWN_VARIABLE_100_900 = new Set([
  "inter",
  "outfit",
  "dm sans",
  "raleway",
  "figtree",
  "manrope",
  "syne",
  "space grotesk",
  "lexend",
  "urbanist",
  "fraunces",
  "bitter",
  "inconsolata",
]);

export function googleFontQuery(family, weightsSet) {
  if (!family || typeof family !== "string") return null;
  const clean = family.trim().replace(/^['"]+|['"]+$/g, "");
  const lower = clean.toLowerCase();
  if (WEB_SAFE_FONTS.has(lower)) return null;

  const encoded = encodeURIComponent(clean).replace(/%20/g, "+");
  if (KNOWN_VARIABLE_100_900.has(lower)) {
    return `${encoded}:wght@100..900`;
  }

  const weights = Array.from(weightsSet || [])
    .map((w) => Number(w))
    .filter((w) => !isNaN(w) && w >= 100 && w <= 900);

  if (weights.length > 0) {
    const sorted = Array.from(new Set(weights)).sort((a, b) => a - b);
    return `${encoded}:wght@${sorted.join(";")}`;
  }

  return `${encoded}:wght@400;700`;
}

/**
 * nodeToReactJsx(rootNode, doc, options) -> A full Next.js / React component (.jsx)
 * styled with Tailwind CSS, accepting className and standard DOM props.
 */
export function nodeToReactJsx(root, doc, options = {}) {
  if (!root) return "";
  const name = pascalCase(root.name || "Component");
  const useClient = options.useClient !== false;

  const fonts = new Map();
  const walkFonts = (n) => {
    if (!n) return;
    if (n.type === "text") {
      if (n.text?.fontFamily) {
        if (!fonts.has(n.text.fontFamily)) fonts.set(n.text.fontFamily, new Set());
        if (n.text.fontWeight) fonts.get(n.text.fontFamily).add(n.text.fontWeight);
      }
      if (n.text?.html) {
        const fams = extractFontFamiliesFromHtml(n.text.html);
        for (const fam of fams) {
          if (!fonts.has(fam)) fonts.set(fam, new Set());
          fonts.get(fam).add(400);
          fonts.get(fam).add(700);
        }
      }
    }
    for (const cid of n.childIds || []) walkFonts(doc?.nodes?.[cid]);
  };
  walkFonts(root);

  const fontLinks = Array.from(fonts.entries())
    .map(([f, ws]) => {
      const q = googleFontQuery(f, ws);
      return q ? `      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${q}&display=swap" />` : null;
    })
    .filter(Boolean)
    .join("\n");

  const render = (node, ctx, depth) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return "";
    const indent = "  ".repeat(depth);
    const classes = tailwindClasses(node, doc, ctx);
    const ctxs = childContexts(node, doc);
    const kids = (node.childIds ?? [])
      .map((id) => doc.nodes[id])
      .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);

    const isRoot = ctx.isRoot;
    const classProp = isRoot
      ? `className={\`${classes} \${className}\`.trim()}`
      : `className="${classes}"`;
    const propsSpread = isRoot ? " {...props}" : "";

    if (node.type === "text") {
      const tag = getTextTag(node);
      if (node.text?.html) {
        const cleanHtml = cleanAndNormalizeHtml(node.text.html);
        if (isRoot && fontLinks) {
          return `${indent}<${tag} ${classProp}${propsSpread}>\n${fontLinks}\n${indent}  <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanHtml)} }} />\n${indent}</${tag}>`;
        }
        return `${indent}<${tag} ${classProp}${propsSpread} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanHtml)} }} />`;
      }
      const content = String(node.text?.content ?? "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (isRoot && fontLinks) {
        return `${indent}<${tag} ${classProp}${propsSpread}>\n${fontLinks}\n${indent}  ${content}\n${indent}</${tag}>`;
      }
      return `${indent}<${tag} ${classProp}${propsSpread}>${content}</${tag}>`;
    }

    if (node.type === "svg") {
      const pathElements = renderSvgElements(node, doc, `${indent}  `, true);
      const w = node.size?.w?.px || 16;
      const h = node.size?.h?.px || 16;
      const vb = node.viewBox || `0 0 ${w} ${h}`;
      return `${indent}<svg ${classProp}${propsSpread} width="${w}" height="${h}" viewBox="${vb}" fill="none">\n${pathElements}\n${indent}</svg>`;
    }

    const fillInfo = getFillInfo(node, doc);
    let styleProp = "";
    if (fillInfo.layered) {
      const blendProp = fillInfo.layered.backgroundBlendMode ? `, backgroundBlendMode: "${fillInfo.layered.backgroundBlendMode}"` : "";
      styleProp = isRoot
        ? ` style={{ backgroundImage: "${fillInfo.layered.backgroundImage}", backgroundSize: "${fillInfo.layered.backgroundSize}", backgroundPosition: "${fillInfo.layered.backgroundPosition}", backgroundRepeat: "${fillInfo.layered.backgroundRepeat}"${blendProp}, ...props.style }}`
        : ` style={{ backgroundImage: "${fillInfo.layered.backgroundImage}", backgroundSize: "${fillInfo.layered.backgroundSize}", backgroundPosition: "${fillInfo.layered.backgroundPosition}", backgroundRepeat: "${fillInfo.layered.backgroundRepeat}"${blendProp} }}`;
    } else if (fillInfo.imageSrc) {
      styleProp = isRoot
        ? ` style={{ backgroundImage: "url('${fillInfo.imageSrc}')", backgroundSize: "${fillInfo.imageFit}", backgroundPosition: "center", ...props.style }}`
        : ` style={{ backgroundImage: "url('${fillInfo.imageSrc}')", backgroundSize: "${fillInfo.imageFit}", backgroundPosition: "center" }}`;
    }

    if (kids.length === 0) {
      if (isRoot && fontLinks) {
        return `${indent}<div ${classProp}${styleProp}${propsSpread}>\n${fontLinks}\n${indent}</div>`;
      }
      return `${indent}<div ${classProp}${styleProp}${propsSpread} />`;
    }

    const innerKids = kids
      .map((c) => render(c, ctxs.get(c.id), depth + 1))
      .filter(Boolean);

    const inner = [isRoot && fontLinks ? fontLinks : null, ...innerKids]
      .filter(Boolean)
      .join("\n");
    return `${indent}<div ${classProp}${styleProp}${propsSpread}>\n${inner}\n${indent}</div>`;
  };

  const body = render(root, { isRoot: true, parentLayout: null }, 2);
  const header = useClient ? `"use client";\n\n` : "";
  return `${header}import React from "react";

export default function ${name}({ className = "", ...props }) {
  return (
${body}
  );
}
`;
}

/**
 * nodeToReactTsx(rootNode, doc, options) -> A full Next.js / React component (.tsx)
 * with TypeScript interface types, styled with Tailwind CSS.
 */
export function nodeToReactTsx(root, doc, options = {}) {
  if (!root) return "";
  const name = pascalCase(root.name || "Component");
  const useClient = options.useClient !== false;

  const fonts = new Map();
  const walkFonts = (n) => {
    if (!n) return;
    if (n.type === "text") {
      if (n.text?.fontFamily) {
        if (!fonts.has(n.text.fontFamily)) fonts.set(n.text.fontFamily, new Set());
        if (n.text.fontWeight) fonts.get(n.text.fontFamily).add(n.text.fontWeight);
      }
      if (n.text?.html) {
        const fams = extractFontFamiliesFromHtml(n.text.html);
        for (const fam of fams) {
          if (!fonts.has(fam)) fonts.set(fam, new Set());
          fonts.get(fam).add(400);
          fonts.get(fam).add(700);
        }
      }
    }
    for (const cid of n.childIds || []) walkFonts(doc?.nodes?.[cid]);
  };
  walkFonts(root);

  const fontLinks = Array.from(fonts.entries())
    .map(([f, ws]) => {
      const q = googleFontQuery(f, ws);
      return q ? `      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${q}&display=swap" />` : null;
    })
    .filter(Boolean)
    .join("\n");

  const render = (node, ctx, depth) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return "";
    const indent = "  ".repeat(depth);
    const classes = tailwindClasses(node, doc, ctx);
    const ctxs = childContexts(node, doc);
    const kids = (node.childIds ?? [])
      .map((id) => doc.nodes[id])
      .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);

    const isRoot = ctx.isRoot;
    const classProp = isRoot
      ? `className={\`${classes} \${className}\`.trim()}`
      : `className="${classes}"`;
    const propsSpread = isRoot ? " {...props}" : "";

    if (node.type === "text") {
      const tag = getTextTag(node);
      if (node.text?.html) {
        const cleanHtml = cleanAndNormalizeHtml(node.text.html);
        if (isRoot && fontLinks) {
          return `${indent}<${tag} ${classProp}${propsSpread}>\n${fontLinks}\n${indent}  <div dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanHtml)} }} />\n${indent}</${tag}>`;
        }
        return `${indent}<${tag} ${classProp}${propsSpread} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(cleanHtml)} }} />`;
      }
      const content = String(node.text?.content ?? "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (isRoot && fontLinks) {
        return `${indent}<${tag} ${classProp}${propsSpread}>\n${fontLinks}\n${indent}  ${content}\n${indent}</${tag}>`;
      }
      return `${indent}<${tag} ${classProp}${propsSpread}>${content}</${tag}>`;
    }

    if (node.type === "svg") {
      const pathElements = renderSvgElements(node, doc, `${indent}  `, true);
      const w = node.size?.w?.px || 16;
      const h = node.size?.h?.px || 16;
      const vb = node.viewBox || `0 0 ${w} ${h}`;
      return `${indent}<svg ${classProp}${propsSpread} width="${w}" height="${h}" viewBox="${vb}" fill="none">\n${pathElements}\n${indent}</svg>`;
    }

    const fillInfo = getFillInfo(node, doc);
    let styleProp = "";
    if (fillInfo.layered) {
      const blendProp = fillInfo.layered.backgroundBlendMode ? `, backgroundBlendMode: "${fillInfo.layered.backgroundBlendMode}"` : "";
      styleProp = isRoot
        ? ` style={{ backgroundImage: "${fillInfo.layered.backgroundImage}", backgroundSize: "${fillInfo.layered.backgroundSize}", backgroundPosition: "${fillInfo.layered.backgroundPosition}", backgroundRepeat: "${fillInfo.layered.backgroundRepeat}"${blendProp}, ...props.style }}`
        : ` style={{ backgroundImage: "${fillInfo.layered.backgroundImage}", backgroundSize: "${fillInfo.layered.backgroundSize}", backgroundPosition: "${fillInfo.layered.backgroundPosition}", backgroundRepeat: "${fillInfo.layered.backgroundRepeat}"${blendProp} }}`;
    } else if (fillInfo.imageSrc) {
      styleProp = isRoot
        ? ` style={{ backgroundImage: "url('${fillInfo.imageSrc}')", backgroundSize: "${fillInfo.imageFit}", backgroundPosition: "center", ...props.style }}`
        : ` style={{ backgroundImage: "url('${fillInfo.imageSrc}')", backgroundSize: "${fillInfo.imageFit}", backgroundPosition: "center" }}`;
    }

    if (kids.length === 0) {
      if (isRoot && fontLinks) {
        return `${indent}<div ${classProp}${styleProp}${propsSpread}>\n${fontLinks}\n${indent}</div>`;
      }
      return `${indent}<div ${classProp}${styleProp}${propsSpread} />`;
    }

    const innerKids = kids
      .map((c) => render(c, ctxs.get(c.id), depth + 1))
      .filter(Boolean);

    const inner = [isRoot && fontLinks ? fontLinks : null, ...innerKids]
      .filter(Boolean)
      .join("\n");
    return `${indent}<div ${classProp}${styleProp}${propsSpread}>\n${inner}\n${indent}</div>`;
  };

  const body = render(root, { isRoot: true, parentLayout: null }, 2);
  const header = useClient ? `"use client";\n\n` : "";
  return `${header}import React from "react";

export interface ${name}Props extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
}

export default function ${name}({ className = "", children, ...props }: ${name}Props) {
  return (
${body}
  );
}
`;
}

/**
 * nodeToAstro(rootNode, doc, options) -> A modern Astro component (.astro)
 * using frontmatter Props and standard HTML/SVG attributes.
 */
export function nodeToAstro(root, doc, options = {}) {
  if (!root) return "";
  const name = pascalCase(root.name || "Component");

  const render = (node, ctx, depth) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return "";
    const indent = "  ".repeat(depth);
    const classes = tailwindClasses(node, doc, ctx);
    const ctxs = childContexts(node, doc);
    const kids = (node.childIds ?? [])
      .map((id) => doc.nodes[id])
      .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);

    const isRoot = ctx.isRoot;
    const classAttr = isRoot
      ? `class={\`${classes} \${className}\`.trim()}`
      : `class="${classes}"`;
    const propsSpread = isRoot ? " {...props}" : "";

    if (node.type === "text") {
      const tag = getTextTag(node);
      if (node.text?.html) {
        return `${indent}<${tag} ${classAttr}${propsSpread} set:html={${JSON.stringify(cleanAndNormalizeHtml(node.text.html))}} />`;
      }
      const content = String(node.text?.content ?? "")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `${indent}<${tag} ${classAttr}${propsSpread}>${content}</${tag}>`;
    }

    if (node.type === "svg") {
      const pathElements = renderSvgElements(node, doc, `${indent}  `, false);
      const w = node.size?.w?.px || 16;
      const h = node.size?.h?.px || 16;
      const vb = node.viewBox || `0 0 ${w} ${h}`;
      return `${indent}<svg ${classAttr}${propsSpread} width="${w}" height="${h}" viewBox="${vb}" fill="none">\n${pathElements}\n${indent}</svg>`;
    }

    const fillInfo = getFillInfo(node, doc);
    let styleAttr = "";
    if (fillInfo.layered) {
      const blend = fillInfo.layered.backgroundBlendMode ? ` background-blend-mode: ${fillInfo.layered.backgroundBlendMode};` : "";
      styleAttr = ` style="background-image: ${fillInfo.layered.backgroundImage}; background-size: ${fillInfo.layered.backgroundSize}; background-position: ${fillInfo.layered.backgroundPosition}; background-repeat: ${fillInfo.layered.backgroundRepeat};${blend}"`;
    } else if (fillInfo.imageSrc) {
      styleAttr = ` style="background-image: url('${fillInfo.imageSrc}'); background-size: ${fillInfo.imageFit}; background-position: center;"`;
    }

    if (kids.length === 0) {
      return `${indent}<div ${classAttr}${styleAttr}${propsSpread}></div>`;
    }

    const inner = kids
      .map((c) => render(c, ctxs.get(c.id), depth + 1))
      .filter(Boolean)
      .join("\n");
    return `${indent}<div ${classAttr}${styleAttr}${propsSpread}>\n${inner}\n${indent}</div>`;
  };

  const template = render(root, { isRoot: true, parentLayout: null }, 0);

  return `---
export interface Props {
  class?: string;
  [key: string]: any;
}

const { class: className = "", ...props } = Astro.props;
---

${template}
`;
}

/**
 * nodeToHtmlDocument(rootNode, doc) -> A complete, standalone HTML5 document
 * containing the full markup styled with Tailwind CSS utility classes and Google Fonts.
 */
export function nodeToHtmlDocument(root, doc) {
  if (!root) return "";

  // Collect Google Fonts used in the subtree and document tokens
  const fonts = new Map();
  fonts.set("Inter", new Set([400, 500, 600, 700]));
  for (const t of doc?.tokens || []) {
    if (t?.type === "font-family" || t?.name?.toLowerCase().includes("font")) {
      const val = t.value || "";
      if (val && typeof val === "string") {
        const primary = val.split(",")[0].trim().replace(/^['"]+|['"]+$/g, "");
        if (primary && !fonts.has(primary)) fonts.set(primary, new Set([400, 500, 600, 700]));
      }
    }
  }
  const walkFonts = (n) => {
    if (!n) return;
    if (n.type === "text") {
      if (n.text?.fontFamily) {
        if (!fonts.has(n.text.fontFamily)) fonts.set(n.text.fontFamily, new Set());
        if (n.text.fontWeight) fonts.get(n.text.fontFamily).add(n.text.fontWeight);
      }
      if (n.text?.html) {
        const fams = extractFontFamiliesFromHtml(n.text.html);
        for (const fam of fams) {
          if (!fonts.has(fam)) fonts.set(fam, new Set());
          fonts.get(fam).add(400);
          fonts.get(fam).add(700);
        }
      }
    }
    for (const cid of n.childIds || []) {
      walkFonts(doc?.nodes?.[cid]);
    }
  };
  walkFonts(root);

  const fontLinks = Array.from(fonts.entries())
    .map(([f, ws]) => {
      const q = googleFontQuery(f, ws);
      return q ? `  <link href="https://fonts.googleapis.com/css2?family=${q}&display=swap" rel="stylesheet">` : null;
    })
    .filter(Boolean)
    .join("\n");

  const render = (node, ctx, depth) => {
    if (node.hidden || node.visible === false || node.style?.opacity === 0) return "";
    const indent = "  ".repeat(depth);
    const classes = tailwindClasses(node, doc, ctx);
    const ctxs = childContexts(node, doc);
    const kids = (node.childIds ?? [])
      .map((id) => doc.nodes[id])
      .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);

    // Style attributes if node has custom inline background image, font family, or root width fallback
    const styles = [];
    if (ctx.isRoot) {
      if (node.size?.w?.kind === "token") {
        const tokenVal = resolveTokenValue(doc?.tokens, node.size.w.tokenId);
        if (tokenVal != null) {
          styles.push(`width: ${typeof tokenVal === "number" ? `${tokenVal}px` : tokenVal}`);
          styles.push("max-width: 100%");
        }
      } else if (node.size?.w?.kind === "fixed" && node.size.w.px != null) {
        styles.push(`width: ${node.size.w.px}px`);
        styles.push("max-width: 100%");
      }
      if (node.size?.h?.kind === "fixed" && node.size.h.px != null) {
        styles.push(`min-height: ${node.size.h.px}px`);
      }
    }
    if (node.type !== "text") {
      const fillInfo = getFillInfo(node, doc);
      if (fillInfo.layered) {
        styles.push(
          `background-image: ${fillInfo.layered.backgroundImage}`,
          `background-size: ${fillInfo.layered.backgroundSize}`,
          `background-position: ${fillInfo.layered.backgroundPosition}`,
          `background-repeat: ${fillInfo.layered.backgroundRepeat}`,
        );
        if (fillInfo.layered.backgroundBlendMode) {
          styles.push(`background-blend-mode: ${fillInfo.layered.backgroundBlendMode}`);
        }
      } else {
        if (fillInfo.imageSrc) {
          styles.push(
            `background-image: url('${fillInfo.imageSrc}')`,
            `background-size: ${fillInfo.imageFit}`,
            "background-position: center",
            fillInfo.imageRepeat === "repeat" ? "background-repeat: repeat" : "background-repeat: no-repeat",
          );
        }
        if (fillInfo.solidColor && !classes.includes(`bg-[${fillInfo.solidColor}]`)) {
          styles.push(`background-color: ${fillInfo.solidColor}`);
        }
      }
    }
    if (node.type === "text" && node.text?.fontFamily) {
      styles.push(`font-family: '${node.text.fontFamily}', system-ui, sans-serif`);
    }

    // Inline borders fallback
    const bordersList = node.style?.borders ?? (node.style?.border ? [node.style.border] : []);
    for (const b of bordersList) {
      if (b.hidden || b.visible === false) continue;
      const c = paintColorCss(b.paint, doc?.tokens) || (b.paint?.color ? cssColor(b.paint.color, b.paint.alpha) : undefined);
      const bStyle = b.style || node.style?.borderStyle || "solid";
      const w = b.width != null ? b.width : 1;
      if (c) {
        if (b.side === "all" || !b.side) {
          styles.push(`border: ${w}px ${bStyle} ${c}`);
        } else {
          styles.push(`border-${b.side}: ${w}px ${bStyle} ${c}`);
        }
      }
    }
    if (node.style?.outline && !node.style.outline.hidden && node.style.outline.visible !== false) {
      const c = paintColorCss(node.style.outline.paint, doc?.tokens) || (node.style.outline.paint?.color ? cssColor(node.style.outline.paint.color, node.style.outline.paint.alpha) : undefined);
      const ost = node.style.outline.style || "solid";
      const w = node.style.outline.width != null ? node.style.outline.width : 1;
      if (c) {
        styles.push(`outline: ${w}px ${ost} ${c}`);
        if (node.style.outline.offset) styles.push(`outline-offset: ${node.style.outline.offset}px`);
      }
    }

    const styleAttr = styles.length > 0 ? ` style="${styles.join("; ")}"` : "";

    if (node.type === "text") {
      const tag = getTextTag(node);
      let content;
      if (node.text?.html) {
        content = cleanAndNormalizeHtml(node.text.html);
      } else {
        content = String(node.text?.content ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }
      return `${indent}<${tag} class="${classes}"${styleAttr}>${content}</${tag}>`;
    }

    if (node.type === "svg") {
      const pathElements = renderSvgElements(node, doc, `${indent}  `, false);
      const w = node.size?.w?.px || 16;
      const h = node.size?.h?.px || 16;
      const vb = node.viewBox || `0 0 ${w} ${h}`;
      return `${indent}<svg class="${classes}"${styleAttr} width="${w}" height="${h}" viewBox="${vb}" fill="none">\n${pathElements}\n${indent}</svg>`;
    }

    if (kids.length === 0) {
      return `${indent}<div class="${classes}"${styleAttr}></div>`;
    }

    const inner = kids
      .map((c) => render(c, ctxs.get(c.id), depth + 1))
      .filter(Boolean)
      .join("\n");
    return `${indent}<div class="${classes}"${styleAttr}>\n${inner}\n${indent}</div>`;
  };

  const bodyContent = render(root, { isRoot: true, parentLayout: null }, 2);
  const title = (root.name || "Frame")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const tokensBlock = tokensCssBlock(doc);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fontLinks}
  <style>
    *, ::before, ::after {
      box-sizing: border-box;
    }
    h1, h2, h3, h4, h5, h6, p {
      margin: 0;
      font-weight: inherit;
      font-size: inherit;
    }
${tokensBlock ? `    ${tokensBlock.split("\n").join("\n    ")}\n` : ""}
    body {
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      background-color: #f8fafc;
      font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
      -webkit-font-smoothing: antialiased;
    }
  </style>
</head>
<body class="min-h-screen bg-slate-100 flex flex-col items-center justify-start p-8">
${bodyContent}
</body>
</html>
`;
}

