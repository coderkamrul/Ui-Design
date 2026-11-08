/**
 * Document data model — Phase 5 §5 of the build plan
 * (~/workspace/paper-design-spec/PHASE-5-build-plan.md), expressed as
 * JSDoc-typed plain objects. The project is JSX (standing stack preference),
 * so types live in JSDoc + these helpers rather than TypeScript.
 *
 * Core ideas carried from the spec:
 * - Frames are the ONLY container. There is no Group node type.
 * - Layout is freeform or flex; flex is deliberately small (direction,
 *   reverse, wrap, ONE gap, padding H/V, alignment) — no grow/shrink.
 * - Properties are CSS-shaped (colours are CSS colour strings, OKLCH
 *   preferred), which is what makes Copy-as-CSS/Tailwind a translation.
 * - Tokens live on the FILE (not the team). A bound property IS a token
 *   reference (a Paint variant), not a flag: detach = replace the reference
 *   with the resolved literal; delete-in-use = auto-detach everywhere.
 * - Every mutation will be an Op (M3): undo = inverse ops, sync = op
 *   stream, version history = op ranges + snapshots.
 */

/**
 * @typedef {string} NodeId
 * @typedef {string} PageId
 * @typedef {string} TokenId
 * @typedef {string} ColorValue Any CSS colour string; OKLCH preferred,
 *   e.g. "oklch(0.62 0.19 256)".
 *
 * @typedef {{ kind: "fixed", px: number }
 *         | { kind: "fit" }
 *         | { kind: "fill" }
 *         | { kind: "relative", pct: number }
 *         | { kind: "token", tokenId: TokenId }} Sizing
 *
 * @typedef {{ kind: "solid", color: ColorValue, alpha?: number }
 *         | { kind: "gradient", gradientType: "linear" | "radial" | "conic",
 *             angle?: number,
 *             stops: Array<{ color: ColorValue, alpha?: number, at: number }> }
 *         | { kind: "image", assetId: string }
 *         | { kind: "token", tokenId: TokenId }} Paint
 *   M2: colours are stored as hex + a separate alpha (0..1) for simplicity;
 *   older paints without `alpha` mean fully opaque. OKLCH strings still
 *   resolve (they come from tokens), they just can't be alpha-edited.
 *
 * @typedef {number | { tl: number, tr: number, br: number, bl: number }
 *         | { tokenId: TokenId }} Corners
 *
 * @typedef {Object} Stroke
 * @property {number} width
 * @property {Paint} paint Solid/token paint only.
 *
 * @typedef {Object} BorderStroke
 * @property {number} width
 * @property {Paint} paint Solid/token paint only.
 * @property {"all" | "top" | "right" | "bottom" | "left"} side
 *
 * @typedef {Object} Shadow
 * @property {number} x @property {number} y @property {number} blur
 * @property {number} spread @property {ColorValue} color
 * @property {number} alpha 0..1
 *
 * @typedef {Object} FilterSet A record of the 8 layer/backdrop filters;
 *   only non-default values reach the CSS string (see FILTER_DEFS).
 * @property {number} blur px (default 0)
 * @property {number} brightness % (default 100)
 * @property {number} contrast % (default 100)
 * @property {number} grayscale % (default 0)
 * @property {number} hueRotate deg (default 0)
 * @property {number} invert % (default 0)
 * @property {number} saturate % (default 100)
 * @property {number} sepia % (default 0)
 *
 * @typedef {Object} NodeStyle
 * @property {Paint} [fill]
 * @property {Stroke} [stroke] Path stroke (M4): the outline of a path
 *   node's bézier curve, distinct from the box outline/border below.
 * @property {Stroke} [outline] Full-perimeter stroke (distinct from border).
 * @property {BorderStroke} [border] Stroke applied to one side (or all).
 * @property {Shadow[]} [shadow]
 * @property {Shadow[]} [innerShadow]
 * @property {FilterSet} [filters] Layer filters.
 * @property {FilterSet} [backdropFilters]
 * @property {string} [blendMode] CSS mix-blend-mode value.
 * @property {number} [opacity] 0..1
 * @property {Corners} [radius]
 *
 * @typedef {Object} DesignNode
 * @property {NodeId} id
 * @property {"frame" | "rect" | "text" | "image" | "path" | "shader"} type
 * @property {string} name Shown in the Layers panel.
 * @property {NodeId | null} parentId
 * @property {NodeId[]} childIds Frames only; order = layout + stacking order.
 * @property {{ mode: "freeform" } | { mode: "flex", direction: "row" | "column",
 *   reverse: boolean, wrap: boolean,
 *   gap: number | { tokenId: TokenId },
 *   padding: { h: number | { tokenId: TokenId }, v: number | { tokenId: TokenId } },
 *   alignMain: string, alignCross: string }} layout
 * @property {{ x: number, y: number, absolute?: boolean }} position
 *   In a flex parent this is ignored unless `absolute` takes the child out of flow.
 * @property {{ w: Sizing, h: Sizing }} size
 * @property {number} [rotation] Degrees.
 * @property {NodeStyle} [style]
 * @property {{ content: string, fontSize: number, fontWeight: number,
 *   lineHeight: number, letterSpacing?: number, align?: string }} [text]
 * @property {{ assetId: string, fit: string }} [image]
 * @property {{ anchors: PathAnchor[], closed: boolean }} [path] Path
 *   geometry (M4, see lib/path.js); anchors are node-local and the node's
 *   position/size are the anchors' bounding box.
 * @property {FrameGuide[]} [guides] Frame guides (M4, frames only).
 * @property {{ preset: string, colors: ColorValue[],
 *   params: { scale: number, rotation: number, distortion: number,
 *   softness: number, grain: number } }} [shader] Shader layer (M5, see
 *   lib/shader.js): our own WebGL mesh gradient — four colour anchors,
 *   five parameters, and the name of the preset it came from ("custom"
 *   once edited by hand).
 *
 * @typedef {Object} PathAnchor A bézier anchor in node-local coords;
 *   `in`/`out` are control POINTS in the same space (null = corner side).
 * @property {number} x @property {number} y
 * @property {{ x: number, y: number } | null} in
 * @property {{ x: number, y: number } | null} out
 * @property {boolean} smooth Smooth anchors mirror their handles.
 *
 * @typedef {{ id: string, kind: "grid", count: number, color: ColorValue,
 *             opacity: number }
 *         | { id: string, kind: "v" | "h", pos: number,
 *             color: ColorValue, opacity: number }} FrameGuide
 *   A grid guide draws `count` equal translucent columns in the frame;
 *   v/h guides are 1px lines at `pos` (frame-local px).
 *
 * @typedef {Object} Page
 * @property {PageId} id
 * @property {string} name
 * @property {ColorValue} background
 * @property {NodeId[]} rootNodeIds
 *
 * @typedef {Object} Token
 * @property {TokenId} id
 * @property {"color" | "opacity" | "radius" | "spacing" | "container"
 *   | "breakpoint" | "fontFamily" | "fontWeight" | "fontSize" | "lineHeight"
 *   | "letterSpacing"} type
 * @property {string} name
 * @property {*} [value] Literal value: CSS string for color/fontFamily,
 *   number for spacing/radius/fontSize, etc.
 * @property {TokenId} [aliasOf] If set, this token aliases another token;
 *   alias chains resolve to the final literal.
 *
 * @typedef {Object} CommentMessage
 * @property {string} id
 * @property {string} author
 * @property {string} text
 * @property {string} ts ISO timestamp.
 *
 * @typedef {Object} FileComment A comment thread pinned to a page point
 *   (M3, basic: threads + resolve; reactions arrive post-MVP).
 * @property {string} id
 * @property {PageId} pageId
 * @property {number} x Page-space (canvas) coordinates of the pin.
 * @property {number} y
 * @property {NodeId | null} nodeId Anchored node, when pinned to one.
 * @property {boolean} resolved
 * @property {string} createdAt ISO timestamp.
 * @property {CommentMessage[]} messages
 *
 * @typedef {Object} DesignFile
 * @property {string} id ULID in production; readable slugs in sample data.
 * @property {string} teamId
 * @property {string} title
 * @property {Page[]} pages
 * @property {Object.<NodeId, DesignNode>} nodes Normalised node table.
 * @property {Token[]} tokens Per-file tokens (the "Theme").
 * @property {FileComment[]} comments Comment threads (M3).
 * @property {Object.<string, string>} assets Image assets (M4):
 *   asset id → dataURL string. Stored inside the document so the M3
 *   persistence (doc JSON in localStorage) carries them unchanged.
 * @property {string} createdBy
 * @property {string} updatedAt ISO timestamp.
 *
 * @typedef {Object} Op
 * @property {number} seq
 * @property {string} actorId
 * @property {number} ts
 * @property {string} kind e.g. "node.update", "node.add", "token.set".
 * @property {Object} payload
 */

/** All token types the Theme system supports (Phase 5 §5). */
export const TOKEN_TYPES = [
  "color",
  "opacity",
  "radius",
  "spacing",
  "container",
  "breakpoint",
  "fontFamily",
  "fontWeight",
  "fontSize",
  "lineHeight",
  "letterSpacing",
];

/**
 * Find a token by id.
 * @param {Token[]} tokens
 * @param {TokenId} id
 * @returns {Token | undefined}
 */
export function getToken(tokens, id) {
  return tokens.find((t) => t.id === id);
}

/**
 * Resolve a token to its literal value, following alias chains.
 * @param {Token[]} tokens
 * @param {TokenId} id
 * @returns {*} The literal value, or undefined if the token is missing.
 */
export function resolveToken(tokens, id) {
  let token = getToken(tokens, id);
  const seen = new Set();
  while (token && token.aliasOf && !seen.has(token.id)) {
    seen.add(token.id);
    token = getToken(tokens, token.aliasOf);
  }
  return token ? token.value : undefined;
}

/**
 * Apply an alpha (0..1) to a CSS colour string. Hex colours become rgba();
 * other colour functions (oklch, …) go through color-mix. Alpha >= 1 (or
 * absent) returns the colour unchanged.
 * @param {ColorValue} color
 * @param {number} [alpha]
 * @returns {string}
 */
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

/** Normalise any stored colour to a #rrggbb string for <input type=color>. */
export function toHexInput(color) {
  if (typeof color !== "string") return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const short = /^#([0-9a-f]{3})$/i.exec(color);
  if (short) {
    return `#${short[1].split("").map((c) => c + c).join("")}`;
  }
  return "#000000"; // oklch/named colours: picker shows black, text field keeps the raw value
}

/**
 * Build the CSS gradient string for a gradient paint.
 * @param {Extract<Paint, { kind: "gradient" }>} paint
 * @returns {string}
 */
export function buildGradientCss(paint) {
  if (paint.stops?.length) {
    const stops = paint.stops
      .map((s, i, arr) => {
        const base = `${cssColor(s.color, s.alpha)} ${s.at}%`;
        const next = arr[i + 1];
        if (typeof s.midpoint === "number" && next) {
          return `${base}, ${s.midpoint}%`;
        }
        return base;
      })
      .join(", ");
    const angle = paint.angle ?? 90;
    switch (paint.gradientType) {
      case "radial":
        return `radial-gradient(circle, ${stops})`;
      case "conic":
        return `conic-gradient(from ${angle}deg, ${stops})`;
      case "linear":
      default:
        return `linear-gradient(${angle}deg, ${stops})`;
    }
  }
  if (paint.css) return paint.css;
  return undefined;
}

/**
 * Resolve a Paint to a CSS `background` value.
 * @param {Paint} paint
 * @param {Token[]} tokens
 * @returns {string | undefined} CSS colour/gradient string, or undefined for
 *   image paints (rendered as an <img>/asset in the real renderer, M1+).
 */
export function resolvePaint(paint, tokens) {
  if (!paint) return undefined;
  switch (paint.kind) {
    case "solid":
      return cssColor(paint.color, paint.alpha);
    case "token":
      return resolveToken(tokens, paint.tokenId);
    case "gradient":
      return buildGradientCss(paint);
    default:
      return undefined;
  }
}

/**
 * Resolve a Paint to a single colour (for text colour / stroke colour).
 * Gradient paints degrade to their first stop.
 * @param {Paint} paint
 * @param {Token[]} tokens
 * @returns {string | undefined}
 */
export function resolvePaintColor(paint, tokens) {
  if (!paint) return undefined;
  if (paint.kind === "gradient") {
    const first = paint.stops?.[0];
    return first ? cssColor(first.color, first.alpha) : undefined;
  }
  return resolvePaint(paint, tokens);
}

/** The 8 filters, in panel order, with CSS function + defaults (Phase 1 v2.3). */
export const FILTER_DEFS = [
  { key: "blur", label: "Blur", fn: "blur", unit: "px", def: 0, min: 0, max: 40 },
  { key: "brightness", label: "Brightness", fn: "brightness", unit: "%", def: 100, min: 0, max: 200 },
  { key: "contrast", label: "Contrast", fn: "contrast", unit: "%", def: 100, min: 0, max: 200 },
  { key: "grayscale", label: "Grayscale", fn: "grayscale", unit: "%", def: 0, min: 0, max: 100 },
  { key: "hueRotate", label: "Hue rotate", fn: "hue-rotate", unit: "deg", def: 0, min: 0, max: 360 },
  { key: "invert", label: "Invert", fn: "invert", unit: "%", def: 0, min: 0, max: 100 },
  { key: "saturate", label: "Saturate", fn: "saturate", unit: "%", def: 100, min: 0, max: 300 },
  { key: "sepia", label: "Sepia", fn: "sepia", unit: "%", def: 0, min: 0, max: 100 },
];

/** A FilterSet with every filter at its default (renders no CSS). */
export function defaultFilters() {
  const out = {};
  for (const d of FILTER_DEFS) out[d.key] = d.def;
  return out;
}

/**
 * Build a CSS filter string from a FilterSet, including ONLY non-default
 * values. Returns undefined when everything is default.
 * @param {FilterSet} [filters]
 * @returns {string | undefined}
 */
export function buildFilterCss(filters) {
  if (!filters) return undefined;
  const parts = [];
  for (const d of FILTER_DEFS) {
    const v = filters[d.key];
    if (v != null && v !== d.def) parts.push(`${d.fn}(${v}${d.unit})`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** Spec defaults for a fresh shadow (Phase 1 v2.3): 0 / 2 / 3 / 0 @ 20%. */
export function defaultShadow() {
  return { x: 0, y: 2, blur: 3, spread: 0, color: "#000000", alpha: 0.2 };
}

/**
 * Build a CSS box-shadow value from shadow lists.
 * @param {Shadow[]} [shadows] @param {Shadow[]} [innerShadows]
 * @returns {string | undefined}
 */
export function buildShadowCss(shadows, innerShadows) {
  const one = (s, inset) =>
    `${inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${cssColor(s.color, s.alpha)}`;
  const parts = [
    ...(shadows ?? []).map((s) => one(s, false)),
    ...(innerShadows ?? []).map((s) => one(s, true)),
  ];
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * CSS border-radius value for a Corners value (number, per-corner record,
 * or a radius-token reference).
 * @param {Corners} [radius] @param {Token[]} tokens
 * @returns {string | undefined}
 */
export function buildRadiusCss(radius, tokens) {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  if (radius.tokenId) {
    const v = resolveToken(tokens, radius.tokenId);
    return typeof v === "number" ? `${v}px` : undefined;
  }
  return `${radius.tl}px ${radius.tr}px ${radius.br}px ${radius.bl}px`;
}

/** True for a `{ tokenId }` reference value (gap/padding/radius bindings). */
export function isTokenRef(v) {
  return v != null && typeof v === "object" && typeof v.tokenId === "string";
}

/**
 * Resolve a `number | { tokenId }` value (gap, padding, …) to a number.
 * @returns {number} 0 when unresolvable.
 */
export function resolveNumeric(v, tokens) {
  if (typeof v === "number") return v;
  if (isTokenRef(v)) {
    const resolved = resolveToken(tokens, v.tokenId);
    return typeof resolved === "number" ? resolved : 0;
  }
  return 0;
}

/**
 * Pixel size for ANY sizing kind: fixed px, token reference resolved, and
 * a typographic estimate for fit text. Fill/relative need a parent size and
 * return undefined here.
 * @param {Sizing} sizing @param {Token[]} tokens
 * @returns {number | undefined}
 */
export function sizingPx(sizing, tokens) {
  if (!sizing) return undefined;
  if (sizing.kind === "fixed") return sizing.px;
  if (sizing.kind === "token") {
    const v = resolveToken(tokens, sizing.tokenId);
    return typeof v === "number" ? v : undefined;
  }
  return undefined;
}

/**
 * Delete-in-use (spec, Phase 1 v3.12): remove a token and AUTO-DETACH every
 * use of it — bound properties become their resolved literal, and tokens
 * that aliased the deleted one become literal tokens holding the resolved
 * value. No warning, no dangling references. MUTATES the doc passed in
 * (callers clone first).
 * @param {import("./model").DesignFile} doc
 * @param {TokenId} tokenId
 */
export function detachToken(doc, tokenId) {
  const literal = resolveToken(doc.tokens, tokenId);

  doc.tokens = doc.tokens
    .filter((t) => t.id !== tokenId)
    .map((t) => {
      if (t.aliasOf !== tokenId) return t;
      const { aliasOf: _drop, ...rest } = t;
      return { ...rest, value: literal };
    });

  const detachPaint = (paint) => {
    if (paint && paint.kind === "token" && paint.tokenId === tokenId) {
      return typeof literal === "string"
        ? { kind: "solid", color: literal, alpha: 1 }
        : undefined;
    }
    return paint;
  };
  const detachNumeric = (v) =>
    isTokenRef(v) && v.tokenId === tokenId
      ? typeof literal === "number"
        ? literal
        : 0
      : v;

  for (const node of Object.values(doc.nodes)) {
    const style = node.style;
    if (style) {
      if (style.fill) style.fill = detachPaint(style.fill);
      if (style.stroke?.paint) style.stroke.paint = detachPaint(style.stroke.paint);
      if (style.outline?.paint) style.outline.paint = detachPaint(style.outline.paint);
      if (style.border?.paint) style.border.paint = detachPaint(style.border.paint);
      if (style.borders && Array.isArray(style.borders)) {
        style.borders.forEach((b) => {
          if (b.paint) b.paint = detachPaint(b.paint);
        });
      }
      if (isTokenRef(style.radius) && style.radius.tokenId === tokenId) {
        style.radius = typeof literal === "number" ? literal : 0;
      }
    }
    if (node.layout?.mode === "flex") {
      node.layout.gap = detachNumeric(node.layout.gap);
      if (node.layout.padding) {
        node.layout.padding.h = detachNumeric(node.layout.padding.h);
        node.layout.padding.v = detachNumeric(node.layout.padding.v);
      }
    }
    for (const axis of ["w", "h"]) {
      const s = node.size?.[axis];
      if (s?.kind === "token" && s.tokenId === tokenId) {
        node.size[axis] =
          typeof literal === "number"
            ? { kind: "fixed", px: literal }
            : { kind: "fixed", px: 0 };
      }
    }
  }
}

/**
 * Pixel size for a Sizing value, when it is a fixed size.
 * @param {Sizing} sizing
 * @returns {number | undefined}
 */
export function sizePx(sizing) {
  return sizing && sizing.kind === "fixed" ? sizing.px : undefined;
}

/**
 * Flatten a page's node tree into Layers-panel order (parents before
 * children, tree order preserved), with depth for indentation.
 * @param {Page} page
 * @param {Object.<NodeId, DesignNode>} nodes
 * @returns {Array<{ node: DesignNode, depth: number }>}
 */
export function flattenLayers(page, nodes) {
  const rows = [];
  const walk = (ids, depth) => {
    for (const id of ids) {
      const node = nodes[id];
      if (!node) continue;
      rows.push({ node, depth });
      if (node.childIds && node.childIds.length > 0) {
        walk(node.childIds, depth + 1);
      }
    }
  };
  walk(page.rootNodeIds, 0);
  return rows;
}

/**
 * Minimal structural validation for a document arriving from OUTSIDE
 * the app — the dashboard's Import JSON flow (platform batch) and,
 * conceptually, the MCP agent API's file format (the MCP server
 * replicates these checks in mcp/server.mjs; it cannot import this
 * module under plain node). Deliberately shallow: a doc is importable
 * when it has at least one page, every page has an id and a
 * rootNodeIds array, and `nodes` is a plain object table. Rendering
 * tolerates partial nodes; corrupt SHAPES are what we reject.
 * @param {*} doc
 * @returns {boolean}
 */
export function isValidDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) return false;
  if (!doc.nodes || typeof doc.nodes !== "object" || Array.isArray(doc.nodes)) {
    return false;
  }
  return doc.pages.every(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof p.id === "string" &&
      Array.isArray(p.rootNodeIds),
  );
}

/**
 * Normalise an imported document for storage under a (possibly new)
 * file identity: returns a deep-cloned doc with `id`/`title` applied
 * when given, and the optional collections (tokens / comments /
 * assets) defaulted so older or hand-written JSON loads cleanly.
 * Assumes isValidDoc(doc) — callers validate first. A stray top-level
 * `versions` key is stripped: history lives BESIDE the doc, never
 * inside it (see lib/versions.js).
 * @param {Object} doc @param {{ id?: string, title?: string }} [identity]
 * @returns {Object} a new DesignFile-shaped object
 */
export function normalizeDoc(doc, identity = {}) {
  const next = structuredClone(doc);
  if (identity.id) next.id = identity.id;
  if (identity.title) next.title = identity.title;
  if (typeof next.title !== "string" || !next.title.trim()) {
    next.title = "Imported file";
  }
  if (typeof next.teamId !== "string") next.teamId = "team-my-team";
  if (typeof next.createdBy !== "string") next.createdBy = "you";
  if (!Array.isArray(next.tokens)) next.tokens = [];
  if (!Array.isArray(next.comments)) next.comments = [];
  if (!next.assets || typeof next.assets !== "object" || Array.isArray(next.assets)) {
    next.assets = {};
  }
  delete next.versions;
  return next;
}

let importNodeSeq = 1;
export function createNode(type, props = {}) {
  const node = {
    id: `node-${Date.now().toString(36)}-${(importNodeSeq++).toString(36)}`,
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    childIds: [],
    parentId: null,
    fills: [],
    ...props,
  };
  if (type === "text" && !node.text) {
    node.text = {
      content: "",
      fontFamily: "Inter",
      fontWeight: 400,
      fontSize: 16,
      lineHeight: 1.25,
      letterSpacing: 0,
      align: "left",
    };
  }
  return node;
}


let importPaintSeq = 1;
export function createPaint(props = {}) {
  return {
    id: `paint-${Date.now().toString(36)}-${(importPaintSeq++).toString(36)}`,
    ...props,
  };
}

export function defaultFlex() {
  return {
    direction: "row",
    reverse: false,
    wrap: false,
    gap: { value: 0, tokenId: null },
    alignMain: "start",
    alignCross: "start",
    padding: {
      top: { value: 0, tokenId: null },
      right: { value: 0, tokenId: null },
      bottom: { value: 0, tokenId: null },
      left: { value: 0, tokenId: null },
    },
  };
}

export function defaultGrid() {
  return {
    mode: "grid",
    display: "grid",
    columns: "repeat(2, 1fr)",
    rows: "auto",
    autoFlow: "row",
    autoColumns: "auto",
    autoRows: "auto",
    gap: 16,
    columnGap: 16,
    rowGap: 16,
    justifyItems: "stretch",
    alignItems: "stretch",
    justifyContent: "start",
    alignContent: "start",
    padding: { t: 0, r: 0, b: 0, l: 0, h: 0, v: 0 },
    areas: "",
  };
}

