"use client";

/**
 * DOM renderer (Phase 5 §3 decision): every document node is a real DOM
 * element inside the Viewport's transformed world div.
 *
 * M2: this component renders the FULL style model — fills (solid, gradient,
 * token), outline, per-side border, shadows + inner shadows, layer and
 * backdrop filters, blend mode, opacity, per-corner radius, rotation — and
 * the flex layout model: a flex frame's element becomes a CSS flex
 * container whose items get their styles from lib/flex.js (including the
 * spec's "first Fill child takes the remainder" rule). Freeform children
 * stay absolutely positioned, parent-relative.
 *
 * Pure rendering only: all pointer interaction lives in Viewport.jsx,
 * which hit-tests via the `data-node-id` attribute below.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cleanAndNormalizeHtml, applyStyleToRange, normalizeElement } from "@/lib/richtext";
import {
  buildFilterCss,
  buildGradientCss,
  buildRadiusCss,
  buildShadowCss,
  resolvePaint,
  resolvePaintColor,
} from "@/lib/model";
import { anchorsToD, pathBounds } from "@/lib/path";
import ShaderNode from "./ShaderNode";
import TextFormatToolbar from "./TextFormatToolbar";
import { loadGoogleFont, extractFontFamiliesFromHtml } from "@/lib/google-fonts";
import {
  alignItems,
  firstFillIndex,
  flexChildStyle,
  flexDirection,
  flowSizeCss,
  inFlowChildren,
  justifyContent,
  resolveNumeric,
} from "@/lib/flex";
import { useEditorStore } from "@/lib/store";
import { toReactStyleKey } from "@/lib/snapshot-import";
import { gridContainerStyle, gridChildStyle } from "@/lib/grid";

export { toReactStyleKey };

const RAW_STYLE_ALLOWLIST = {
  // Transform
  "transform": "transform",
  "perspective": "perspective",
  "backface-visibility": "backfaceVisibility",
  // Sizing constraints
  "max-width": "maxWidth",
  "min-width": "minWidth",
  "max-height": "maxHeight",
  "min-height": "minHeight",
  // Margins
  "margin": "margin",
  "margin-top": "marginTop",
  "margin-bottom": "marginBottom",
  "margin-left": "marginLeft",
  "margin-right": "marginRight",
  "margin-inline-start": "marginInlineStart",
  "margin-inline-end": "marginInlineEnd",
  "margin-block-start": "marginBlockStart",
  "margin-block-end": "marginBlockEnd",
  // Object / image
  "object-fit": "objectFit",
  "object-position": "objectPosition",
  "aspect-ratio": "aspectRatio",
  // Background extended
  "background-size": "backgroundSize",
  "background-position": "backgroundPosition",
  "background-repeat": "backgroundRepeat",
  "background-attachment": "backgroundAttachment",
  "background-origin": "backgroundOrigin",
  "background-clip": "backgroundClip",
  // CSS Masking — critical for gradient text, decorative overlays
  "mask-image": "maskImage",
  "-webkit-mask-image": "WebkitMaskImage",
  "mask-position": "maskPosition",
  "-webkit-mask-position": "WebkitMaskPosition",
  "mask-position-x": "maskPositionX",
  "-webkit-mask-position-x": "WebkitMaskPositionX",
  "mask-position-y": "maskPositionY",
  "-webkit-mask-position-y": "WebkitMaskPositionY",
  "mask-size": "maskSize",
  "-webkit-mask-size": "WebkitMaskSize",
  "mask-repeat": "maskRepeat",
  "-webkit-mask-repeat": "WebkitMaskRepeat",
  "mask-origin": "maskOrigin",
  "-webkit-mask-origin": "WebkitMaskOrigin",
  "mask-clip": "maskClip",
  "-webkit-mask-clip": "WebkitMaskClip",
  "mask-mode": "maskMode",
  "-webkit-mask-mode": "WebkitMaskMode",
  "mask-composite": "maskComposite",
  "-webkit-mask-composite": "WebkitMaskComposite",
  // Clip path
  "clip-path": "clipPath",
  "-webkit-clip-path": "WebkitClipPath",
  // Text
  "text-overflow": "textOverflow",
  "white-space": "whiteSpace",
  "word-break": "wordBreak",
  "overflow-wrap": "overflowWrap",
  "text-transform": "textTransform",
  "text-shadow": "textShadow",
  "text-indent": "textIndent",
  "-webkit-text-stroke": "WebkitTextStroke",
  "-webkit-text-stroke-width": "WebkitTextStrokeWidth",
  "-webkit-text-stroke-color": "WebkitTextStrokeColor",
  "letter-spacing": "letterSpacing",
  // Line clamp
  "-webkit-line-clamp": "WebkitLineClamp",
  "line-clamp": "WebkitLineClamp",
  // Vertical
  "vertical-align": "verticalAlign",
  "writing-mode": "writingMode",
  "direction": "direction",
  // Flex children
  "flex-grow": "flexGrow",
  "flex-shrink": "flexShrink",
  "flex-basis": "flexBasis",
  "align-self": "alignSelf",
  "order": "order",
  // Filter effects
  "filter": "filter",
  "-webkit-filter": "filter",
  "backdrop-filter": "backdropFilter",
  "-webkit-backdrop-filter": "backdropFilter",
  // Interaction
  "cursor": "cursor",
  "pointer-events": "pointerEvents",
  "user-select": "userSelect",
  "-webkit-user-select": "WebkitUserSelect",
  // Animation & Transition
  "animation": "animation",
  "animation-name": "animationName",
  "animation-duration": "animationDuration",
  "animation-timing-function": "animationTimingFunction",
  "animation-delay": "animationDelay",
  "animation-iteration-count": "animationIterationCount",
  "animation-direction": "animationDirection",
  "animation-fill-mode": "animationFillMode",
  "animation-play-state": "animationPlayState",
  "transition": "transition",
  "transition-property": "transitionProperty",
  "transition-duration": "transitionDuration",
  "transition-timing-function": "transitionTimingFunction",
  "transition-delay": "transitionDelay",
  // Appearance & Styling extras
  "appearance": "appearance",
  "-webkit-appearance": "WebkitAppearance",
  "caret-color": "caretColor",
  "accent-color": "accentColor",
  "scrollbar-width": "scrollbarWidth",
  "column-rule-color": "columnRuleColor",
  "column-rule-style": "columnRuleStyle",
  "column-rule-width": "columnRuleWidth",
  "contain": "contain",
  "isolation": "isolation",
  "will-change": "willChange",
  "aspect-ratio": "aspectRatio",
};

export function getRawStyleProps(node) {
  const raw = node?.rawStyle;
  const custom = node?.style?.customCss;
  if (!raw && !custom) return {};

  const merged = { ...(raw || {}) };
  if (custom && typeof custom === "object") {
    for (const [prop, item] of Object.entries(custom)) {
      if (typeof item === "object" && item !== null) {
        if (item.enabled === false) {
          delete merged[prop];
        } else if (item.value != null && item.value !== "") {
          merged[prop] = item.value;
        }
      } else if (item != null && item !== "") {
        merged[prop] = item;
      }
    }
  }

  // Properties where "none", "auto", "normal" etc. are meaningful values (must NOT be stripped)
  const PRESERVE_ALL_VALUES = new Set([
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
    "clip-path", "-webkit-clip-path",
    "background-clip", "background-origin", "background-attachment",
    "pointer-events", "user-select", "-webkit-user-select",
    "cursor", "direction", "writing-mode",
    "object-fit", "object-position",
    "animation", "animation-name", "animation-duration", "animation-timing-function",
    "animation-delay", "animation-iteration-count", "animation-direction",
    "animation-fill-mode", "animation-play-state",
    "transition", "transition-property", "transition-duration",
    "transition-timing-function", "transition-delay",
    "appearance", "-webkit-appearance", "scrollbar-width",
  ]);

  const out = {};
  for (const [prop, targetProp] of Object.entries(RAW_STYLE_ALLOWLIST)) {
    const val = merged[prop] ?? merged[targetProp];
    if (val == null || val === "") continue;
    // For mask/clip/etc., preserve every non-empty value including "none"/"auto"/"normal"
    if (PRESERVE_ALL_VALUES.has(prop)) {
      out[targetProp] = val;
    } else if (prop === "transform") {
      // Only apply non-trivial transforms
      if (val !== "none") out[targetProp] = val;
    } else {
      out[targetProp] = val;
    }
  }
  // For any remaining properties in merged that are not in RAW_STYLE_ALLOWLIST,
  // apply them as camelCase / custom CSS properties safely
  for (const [prop, val] of Object.entries(merged)) {
    if (val == null || val === "") continue;
    // Borders are managed by node.borders via styleProps; ignore orphan border properties in raw styles
    const isBorderProp = (prop.startsWith("border") || prop.startsWith("-webkit-border")) && !prop.includes("radius");
    if (isBorderProp) continue;
    // Padding is managed by node.layout.padding / node.padding; ignore raw padding properties on containers
    const isPaddingProp = prop.startsWith("padding") || prop.startsWith("-webkit-padding");
    if (isPaddingProp && (node.layout?.padding != null || node.padding != null || node.type === "frame")) continue;
    const targetProp = RAW_STYLE_ALLOWLIST[prop] || toReactStyleKey(prop);
    if (targetProp && !out[targetProp]) {
      out[targetProp] = val;
    }
  }
  const clampVal = merged["-webkit-line-clamp"] ?? merged["line-clamp"] ?? merged["WebkitLineClamp"];
  if (clampVal != null && clampVal !== "" && clampVal !== "none") {
    out.WebkitLineClamp = clampVal;
    out.display = "-webkit-box";
    out.WebkitBoxOrient = "vertical";
    out.overflow = "hidden";
  }
  // Canvas elements must never display internal scrollbars
  if (out.overflow === "scroll" || out.overflow === "auto") delete out.overflow;
  if (out.overflowX === "scroll" || out.overflowX === "auto") delete out.overflowX;
  if (out.overflowY === "scroll" || out.overflowY === "auto") delete out.overflowY;
  return out;
}

/** Style props shared by every node type, from node.style. */
function styleProps(node, tokens) {
  const s = node.style ?? {};
  const out = {};

  const isDropShadow = s.shadowType === "drop";
  const normShadow = (sh) => {
    if (!sh) return sh;
    const op = sh.opacity != null ? (sh.opacity > 1 ? sh.opacity / 100 : sh.opacity) : 1;
    return { ...sh, alpha: sh.alpha ?? op };
  };
  const rawDrop = s.shadow ?? s.shadows ?? node.shadows ?? [];
  const rawInner = s.innerShadow ?? s.innerShadows ?? node.innerShadows ?? [];
  const dropList = (Array.isArray(rawDrop) ? rawDrop : [rawDrop]).map(normShadow);
  const innerList = (Array.isArray(rawInner) ? rawInner : [rawInner]).map(normShadow);
  if (isDropShadow) {
    const dropParts = dropList
      .filter((sh) => !sh.hidden)
      .map((sh) => {
        const c = resolvePaintColor({ kind: "solid", color: sh.color, alpha: sh.alpha ?? 1 }, tokens) || sh.color || "rgba(0,0,0,0.2)";
        return `drop-shadow(${sh.x ?? 0}px ${sh.y ?? 2}px ${sh.blur ?? 3}px ${c})`;
      });
    const filter = buildFilterCss(s.filters);
    const combinedFilter = [filter, ...dropParts].filter(Boolean).join(" ");
    if (combinedFilter) out.filter = combinedFilter;
    if (innerList.length) {
      out.boxShadow = buildShadowCss([], innerList);
    }
  } else {
    const shadow = buildShadowCss(dropList, innerList);
    if (shadow) out.boxShadow = shadow;
    const filter = buildFilterCss(s.filters);
    if (filter) out.filter = filter;
  }
  const backdrop = buildFilterCss(s.backdropFilters);
  if (backdrop) out.backdropFilter = backdrop;

  if (s.blendMode && s.blendMode !== "normal") out.mixBlendMode = s.blendMode;
  if (s.opacity != null && s.opacity !== 1) out.opacity = s.opacity;

  const radius = buildRadiusCss(s.radius, tokens);
  if (radius) out.borderRadius = radius;

  if (s.outline && !s.outline.hidden) {
    const color = resolvePaintColor(s.outline.paint, tokens);
    const outlineStyle = s.outline.style || "solid";
    const width = s.outline.width ?? 1;
    if (color && outlineStyle !== "none" && width > 0 && color !== "transparent" && color !== "rgba(0, 0, 0, 0)" && color !== "rgba(0,0,0,0)") {
      out.outline = `${width}px ${outlineStyle} ${color}`;
      if (s.outline.offset) {
        out.outlineOffset = `${s.outline.offset}px`;
      }
    }
  }
  const rawBorders = s.borders ?? (s.border ? [s.border] : (node.borders ?? []));
  const bordersList = Array.isArray(rawBorders) ? rawBorders : [rawBorders];
  for (const b of bordersList) {
    if (!b || b.hidden || b.width <= 0) continue;
    if (b.alpha != null && b.alpha <= 0) continue;
    if (b.opacity != null && b.opacity <= 0) continue;
    if (b.style === "none") continue;
    const color = resolvePaintColor(b.paint, tokens) || (b.color ? cssColor(b.color, b.alpha ?? (b.opacity != null ? (b.opacity > 1 ? b.opacity / 100 : b.opacity) : 1)) : undefined);
    if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)" || color === "rgba(0,0,0,0)") continue;
    const bStyle = b.style || s.borderStyle || "solid";
    const side = (b.side || "all").toLowerCase();
    const value = `${b.width}px ${bStyle} ${color}`;
    if (side === "all") out.border = value;
    else {
      const sideCap = side[0].toUpperCase() + side.slice(1);
      out[`border${sideCap}`] = value;
    }
  }
  if (s.color) out.color = s.color;
  if (node.rotation) {
    out.transform = `rotate(${node.rotation}deg)`;
    out.transformOrigin = "center center";
  }

  // Constraints & sizing
  if (node.maxWidth) {
    out.maxWidth = typeof node.maxWidth === "number" ? `${node.maxWidth}px` : node.maxWidth;
  }
  if (node.minWidth) {
    out.minWidth = typeof node.minWidth === "number" ? `${node.minWidth}px` : node.minWidth;
  }
  if (node.maxHeight) {
    out.maxHeight = typeof node.maxHeight === "number" ? `${node.maxHeight}px` : node.maxHeight;
  }
  if (node.minHeight) {
    out.minHeight = typeof node.minHeight === "number" ? `${node.minHeight}px` : node.minHeight;
  }
  // Margin (from layout.margin or margin)
  const marginLayout = node.layout?.margin ?? node.margin;
  if (marginLayout) {
    const marTop = resolveNumeric(marginLayout.t ?? marginLayout.v ?? 0, tokens);
    const marBottom = resolveNumeric(marginLayout.b ?? marginLayout.v ?? 0, tokens);
    const isAutoH = Boolean(node.centerX || marginLayout.autoH || (marginLayout.auto && marginLayout.auto.left && marginLayout.auto.right) || marginLayout.l === "auto" || marginLayout.r === "auto");
    const isAutoV = Boolean(node.centerY || marginLayout.autoV || (marginLayout.auto && marginLayout.auto.top && marginLayout.auto.bottom) || marginLayout.t === "auto" || marginLayout.b === "auto");
    
    out.marginTop = isAutoV ? "auto" : (marTop ? `${marTop}px` : undefined);
    out.marginRight = isAutoH ? "auto" : (marginLayout.r ? `${resolveNumeric(marginLayout.r ?? marginLayout.h ?? 0, tokens)}px` : undefined);
    out.marginBottom = isAutoV ? "auto" : (marBottom ? `${marBottom}px` : undefined);
    out.marginLeft = isAutoH ? "auto" : (marginLayout.l ? `${resolveNumeric(marginLayout.l ?? marginLayout.h ?? 0, tokens)}px` : undefined);
  } else {
    if (node.centerX) {
      out.marginLeft = "auto";
      out.marginRight = "auto";
    }
    if (node.centerY) {
      out.marginTop = "auto";
      out.marginBottom = "auto";
    }
  }

  // Padding (from layout.padding or padding)
  const paddingLayout = node.layout?.padding ?? node.padding;
  if (paddingLayout) {
    const padTop = Math.max(0, resolveNumeric(paddingLayout.t ?? paddingLayout.v ?? 0, tokens) || 0);
    const padRight = Math.max(0, resolveNumeric(paddingLayout.r ?? paddingLayout.h ?? 0, tokens) || 0);
    const padBottom = Math.max(0, resolveNumeric(paddingLayout.b ?? paddingLayout.v ?? 0, tokens) || 0);
    const padLeft = Math.max(0, resolveNumeric(paddingLayout.l ?? paddingLayout.h ?? 0, tokens) || 0);
    out.padding = `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`;
  }

  // Custom CSS (Other styles section)
  if (s.customCss && typeof s.customCss === "object") {
    for (const [prop, raw] of Object.entries(s.customCss)) {
      const isEnabled = typeof raw === "object" && raw !== null ? raw.enabled !== false : Boolean(raw);
      const val = typeof raw === "object" && raw !== null ? raw.value : raw;
      if (isEnabled && val != null && val !== "") {
        const camelProp = toReactStyleKey(prop);
        if (camelProp) {
          out[camelProp] = val;
        }
      }
    }
  }

  // Sanitised allowlist from node.rawStyle applied LAST
  const rawProps = getRawStyleProps(node);
  if (rawProps.transform) {
    if (node.rotation && !rawProps.transform.includes("rotate(")) {
      out.transform = `${rawProps.transform} rotate(${node.rotation}deg)`;
      out.transformOrigin = "center center";
    } else {
      out.transform = rawProps.transform;
      out.transformOrigin = "center center";
    }
    delete rawProps.transform;
  }
  const explicitPadding = out.padding;
  Object.assign(out, rawProps);
  if (explicitPadding !== undefined) {
    out.padding = explicitPadding;
    delete out.paddingLeft;
    delete out.paddingRight;
    delete out.paddingTop;
    delete out.paddingBottom;
    delete out.paddingInline;
    delete out.paddingBlock;
  }
  if (out.overflow === "scroll" || out.overflow === "auto") delete out.overflow;
  if (out.overflowX === "scroll" || out.overflowX === "auto") delete out.overflowX;
  if (out.overflowY === "scroll" || out.overflowY === "auto") delete out.overflowY;

  return out;
}

/** CSS background-size for an image fit keyword. */
function fitCss(fit) {
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

/** Background props from a node's fill paint (single or multiple fills). */
function fillProps(node, tokens, assets) {
  const fills = node.style?.fills?.length
    ? node.style.fills
    : node.style?.fill
      ? [node.style.fill]
      : [];
  if (!fills.length) return {};

  const visibleFills = fills.filter((f) => f && f.visible !== false && !f.hidden);
  if (!visibleFills.length) return {};

  // Single fill: standard CSS properties
  if (visibleFills.length === 1) {
    const fill = visibleFills[0];
    if (fill.kind === "gradient") {
      return { backgroundImage: resolvePaint(fill, tokens) };
    }
    if (fill.kind === "image") {
      const url = assets?.[fill.assetId] || fill.url;
      if (!url) return {};
      return {
        backgroundImage: `url(${url})`,
        backgroundSize: fitCss(fill.fit),
        backgroundPosition: "center",
        backgroundRepeat: fill.fit === "tile" ? "repeat" : "no-repeat",
      };
    }
    const css = resolvePaint(fill, tokens);
    return css ? { backgroundColor: css } : {};
  }

  // Multiple fills: layered background images + blend modes
  const bgImages = [];
  const bgSizes = [];
  const bgPositions = [];
  const bgRepeats = [];
  const blendModes = [];

  for (const fill of visibleFills) {
    const blend = fill.blendMode || "normal";
    blendModes.push(blend);

    if (fill.kind === "gradient") {
      bgImages.push(resolvePaint(fill, tokens) || "none");
      bgSizes.push("100% 100%");
      bgPositions.push("center");
      bgRepeats.push("no-repeat");
    } else if (fill.kind === "image") {
      const url = assets?.[fill.assetId] || fill.url;
      if (url) {
        bgImages.push(`url(${url})`);
        bgSizes.push(fitCss(fill.fit));
        bgPositions.push("center");
        bgRepeats.push(fill.fit === "tile" ? "repeat" : "no-repeat");
      }
    } else {
      const cssColor = resolvePaint(fill, tokens) || fill.color || "#FFFFFF";
      bgImages.push(`linear-gradient(${cssColor}, ${cssColor})`);
      bgSizes.push("100% 100%");
      bgPositions.push("center");
      bgRepeats.push("no-repeat");
    }
  }

  if (!bgImages.length) return {};

  return {
    backgroundImage: bgImages.join(", "),
    backgroundSize: bgSizes.join(", "),
    backgroundPosition: bgPositions.join(", "),
    backgroundRepeat: bgRepeats.join(", "),
    backgroundBlendMode: blendModes.join(", "),
  };
}

/** Frame guides (M4): grid columns + v/h lines, drawn over the frame's
 *  children, pointer-events disabled. Positions are frame-local.
 *  Depth-gap batch: while a line guide is being dragged on the canvas,
 *  the store's transient guideDrag position wins over the doc value —
 *  the doc itself (and history) only change on drop. */
function GuideOverlays({ node }) {
  const guideDrag = useEditorStore((s) => s.guideDrag);
  const guides = node.guides ?? [];
  if (guides.length === 0) return null;
  const posOf = (g) =>
    guideDrag && guideDrag.frameId === node.id && guideDrag.guideId === g.id
      ? guideDrag.pos
      : g.pos;
  return (
    <>
      {guides.map((g) => {
        if (g.hidden) return null;
        if (g.kind === "grid") {
          const gridSize = g.size ?? g.count ?? 8;
          const gridColor = g.color || "#003880";
          return (
            <div
              key={g.id}
              data-guide-id={g.id}
              style={{
                position: "absolute",
                inset: 0,
                opacity: g.opacity ?? 0.1,
                pointerEvents: "none",
                backgroundImage: `linear-gradient(to right, ${gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                zIndex: 10,
              }}
            />
          );
        }
        if (g.kind === "column") {
          const count = Math.max(1, g.count ?? 12);
          const gutter = g.gutter ?? 8;
          const margin = g.margin ?? 0;
          const align = g.align ?? "stretch";
          const colColor = g.color || "#003880";
          const colAlpha = g.opacity ?? 0.1;

          if (align === "stretch") {
            return (
              <div
                key={g.id}
                data-guide-id={g.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  paddingLeft: `${margin}px`,
                  paddingRight: `${margin}px`,
                  gap: `${gutter}px`,
                  opacity: colAlpha,
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: "100%", backgroundColor: colColor }} />
                ))}
              </div>
            );
          } else {
            const colWidth = g.size ?? 40;
            let justify = "flex-start";
            if (align === "center") justify = "center";
            else if (align === "end") justify = "flex-end";

            return (
              <div
                key={g.id}
                data-guide-id={g.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  justifyContent: justify,
                  paddingLeft: align === "start" ? `${margin}px` : undefined,
                  paddingRight: align === "end" ? `${margin}px` : undefined,
                  gap: `${gutter}px`,
                  opacity: colAlpha,
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} style={{ width: `${colWidth}px`, flexShrink: 0, height: "100%", backgroundColor: colColor }} />
                ))}
              </div>
            );
          }
        }
        if (g.kind === "row") {
          const count = Math.max(1, g.count ?? 12);
          const gutter = g.gutter ?? 8;
          const margin = g.margin ?? 0;
          const align = g.align ?? "stretch";
          const rowColor = g.color || "#003880";
          const rowAlpha = g.opacity ?? 0.1;

          if (align === "stretch") {
            return (
              <div
                key={g.id}
                data-guide-id={g.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  paddingTop: `${margin}px`,
                  paddingBottom: `${margin}px`,
                  gap: `${gutter}px`,
                  opacity: rowAlpha,
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} style={{ flex: 1, width: "100%", backgroundColor: rowColor }} />
                ))}
              </div>
            );
          } else {
            const rowHeight = g.size ?? 40;
            let justify = "flex-start";
            if (align === "center") justify = "center";
            else if (align === "end") justify = "flex-end";

            return (
              <div
                key={g.id}
                data-guide-id={g.id}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: justify,
                  paddingTop: align === "start" ? `${margin}px` : undefined,
                  paddingBottom: align === "end" ? `${margin}px` : undefined,
                  gap: `${gutter}px`,
                  opacity: rowAlpha,
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} style={{ height: `${rowHeight}px`, flexShrink: 0, width: "100%", backgroundColor: rowColor }} />
                ))}
              </div>
            );
          }
        }
        if (g.kind === "v") {
          return (
            <div
              key={g.id}
              data-guide-id={g.id}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: posOf(g),
                width: 1,
                background: g.color,
                opacity: g.opacity ?? 0.6,
                pointerEvents: "none",
              }}
            />
          );
        }
        return (
          <div
            key={g.id}
            data-guide-id={g.id}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: posOf(g),
              height: 1,
              background: g.color,
              opacity: g.opacity ?? 0.6,
              pointerEvents: "none",
            }}
          />
        );
      })}
    </>
  );
}

function FrameNameLabel({ node, isSelected }) {
  if (!node || node.hidden || node.visible === false || node.style?.opacity === 0) return null;
  const patchNode = useEditorStore((s) => s.patchNode);
  const zoom = useEditorStore((s) => s.viewport.zoom) || 1;
  const invZoom = 1 / zoom;
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name || "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isEditing) {
      setEditName(node.name || "");
    }
  }, [node.name, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    const handleRenameReq = (e) => {
      if (e.detail?.id === node.id) {
        setIsEditing(true);
        setEditName(node.name || "");
      }
    };
    window.addEventListener("canvas:rename-node", handleRenameReq);
    window.addEventListener("canvas:rename-frame-title", handleRenameReq);
    return () => {
      window.removeEventListener("canvas:rename-node", handleRenameReq);
      window.removeEventListener("canvas:rename-frame-title", handleRenameReq);
    };
  }, [node.id, node.name]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== node.name) {
      patchNode(node.id, { name: trimmed });
    }
    setIsEditing(false);
  };

  const cancelRename = () => {
    setEditName(node.name || "");
    setIsEditing(false);
  };

  const marT = Number(node.layout?.margin?.t ?? node.layout?.margin?.v ?? 0) || 0;
  const marL = Number(node.layout?.margin?.l ?? node.layout?.margin?.h ?? 0) || 0;

  const rawX = Number(node.position?.x ?? node.x ?? 0);
  const rawY = Number(node.position?.y ?? node.y ?? 0);
  const posX = (Number.isFinite(rawX) ? rawX : 0) - marL;
  const posY = (Number.isFinite(rawY) ? rawY : 0) - marT;

  const rot = Number(node.rotation ?? 0);
  const w = Number(node.size?.w?.px ?? node.w ?? 100);
  const h = Number(node.size?.h?.px ?? node.h ?? 100);

  const containerStyle = {
    position: "absolute",
    left: posX,
    top: posY,
    width: w,
    height: h,
    transform: rot ? `rotate(${rot}deg)` : undefined,
    transformOrigin: "center center",
    pointerEvents: "none",
    zIndex: isEditing ? 1000 : 20,
  };

  if (isEditing) {
    return (
      <div style={containerStyle}>
        <div
          data-frame-title-editing={node.id}
          style={{
            position: "absolute",
            left: 0,
            bottom: "calc(100% + 6px)",
            transformOrigin: "bottom left",
            transform: `scale(${invZoom})`,
            pointerEvents: "auto",
            zIndex: 1000,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={commitRename}
            className="rounded px-1.5 py-0.5 font-medium outline-none border border-[var(--accent)] bg-[var(--surface-content)] text-[var(--text-1)] shadow-sm font-sans"
            style={{
              fontSize: "11px",
              minWidth: 70,
              maxWidth: 300,
              height: 22,
              lineHeight: "18px",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div
        data-frame-title-id={node.id}
        onPointerDown={(e) => {
          if (e.detail >= 2) {
            e.stopPropagation();
            e.preventDefault();
            setIsEditing(true);
            setEditName(node.name || "");
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsEditing(true);
          setEditName(node.name || "");
        }}
        style={{
          position: "absolute",
          left: 0,
          bottom: "calc(100% + 6px)",
          transformOrigin: "bottom left",
          transform: `scale(${invZoom})`,
          fontSize: "11px",
          lineHeight: "14px",
          fontFamily: "var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
          color: isSelected ? "var(--accent)" : "var(--text-2)",
          fontWeight: isSelected ? 600 : 400,
          userSelect: "none",
          pointerEvents: "auto",
          whiteSpace: "nowrap",
          cursor: "default",
          padding: "2px 4px",
          borderRadius: "3px",
        }}
        title="Double-click to rename"
      >
        {node.name || "Frame"}
      </div>
    </div>
  );
}

function TextNodeContent({ node, tokens, common }) {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const setEditingTextId = useEditorStore((s) => s.setEditingTextId);
  const patchNodeText = useEditorStore((s) => s.patchNodeText);
  const isEditing = editingTextId === node.id;
  const t = node.text ?? {};
  const elRef = useRef(null);

  const [selectionCoords, setSelectionCoords] = useState(null);
  const [activeFormats, setActiveFormats] = useState({});
  const savedRangeRef = useRef(null);
  const toolbarActiveRef = useRef(false);

  useEffect(() => {
    if (t.fontFamily) {
      loadGoogleFont(t.fontFamily);
    }
    if (t.html) {
      const fonts = extractFontFamiliesFromHtml(t.html);
      for (const fam of fonts) {
        loadGoogleFont(fam);
      }
    }
  }, [t.fontFamily, t.html]);

  const underline = node.style?.underline ?? (t.underline ? { width: 1, offset: "Auto", paint: { kind: "solid", color: "#000000", alpha: 1 } } : null);
  const stroke = node.style?.textStroke ?? node.style?.stroke ?? (t.stroke ? { width: t.strokeWidth ?? 1, position: t.strokePosition ?? "below", paint: { kind: "solid", color: t.strokeColor ?? "#000000", alpha: 1 } } : null);

  const isTruncated = Boolean(t.truncation);
  const isLineClamped = Boolean(node.rawStyle?.["-webkit-line-clamp"] || node.rawStyle?.["line-clamp"] || t.lineClamp);
  const lineClampVal = node.rawStyle?.["-webkit-line-clamp"] || node.rawStyle?.["line-clamp"] || t.lineClamp;
  const shouldTruncate = isTruncated || Boolean(node.rawStyle?.["text-overflow"] === "ellipsis");
  const activeTruncate = shouldTruncate && !isEditing;

  const hasMaxWidth = Boolean(node.rawStyle?.["max-width"] || t.maxWidth);
  const rawWs = (node.rawStyle?.["white-space"] || node.rawStyle?.whiteSpace || "").toLowerCase();
  const explicitNowrap = rawWs === "nowrap" || rawWs === "pre";

  // Text wraps by default to follow parent width unless explicitly declared nowrap or active ellipsis
  const isNowrap = activeTruncate || explicitNowrap || t.wrap === "none" || t.wrap === "nowrap";

  const textInnerStyle = {
    ...fillPropsAsColor(node, tokens),
    fontFamily: t.fontFamily ? `"${t.fontFamily}", sans-serif` : undefined,
    fontStyle: (t.italic || t.fontStyle === "Italic" || t.fontStyle === "italic") ? "italic" : undefined,
    fontSize: t.fontSize ?? 16,
    fontWeight: t.fontWeight ?? 400,
    lineHeight: t.lineHeight ?? 1.25,
    letterSpacing: (() => {
      const ls = t.letterSpacing;
      if (ls == null || ls === "" || ls === 0 || ls === "0" || ls === "0%") return undefined;
      if (typeof ls === "number") return `${ls / 100}em`;
      const str = String(ls).trim();
      if (str.endsWith("%")) {
        const n = parseFloat(str);
        return !isNaN(n) ? `${n / 100}em` : str;
      }
      if (str.endsWith("px")) return str;
      const n = parseFloat(str);
      return !isNaN(n) ? `${n / 100}em` : str;
    })(),
    textAlign: t.align ?? "left",
    textTransform: t.case && t.case !== "none" ? t.case : t.textTransform || undefined,
    wordBreak: isNowrap ? "normal" : "break-word",
    overflowWrap: isNowrap ? "normal" : "break-word",
    lineBreak: "auto",
    whiteSpace: activeTruncate ? "nowrap" : (isNowrap ? "nowrap" : "pre-wrap"),
    overflow: (activeTruncate || isLineClamped || node.rawStyle?.overflow === "hidden") ? "hidden" : undefined,
    textOverflow: activeTruncate ? "ellipsis" : (node.rawStyle?.["text-overflow"] || undefined),
    ...(underline && !underline.hidden ? {
      textDecorationLine: "underline",
      textDecorationThickness: `${underline.width ?? 1}px`,
      textUnderlineOffset: underline.offset && underline.offset !== "Auto" && underline.offset !== "auto"
        ? (typeof underline.offset === "number" ? `${underline.offset}px` : underline.offset)
        : "auto",
      textDecorationColor: resolvePaintColor(underline.paint, tokens) || "currentColor",
    } : {
      textDecoration: t.textDecoration || undefined,
    }),
    ...(stroke && !stroke.hidden ? {
      WebkitTextStroke: `${stroke.width ?? 1}px ${resolvePaintColor(stroke.paint, tokens) || "#000000"}`,
      paintOrder: (stroke.position === "below" || !stroke.position) ? "stroke fill" : "fill stroke",
    } : {}),
    textShadow: t.textShadow || undefined,
  };

  const handleSelectionChange = () => {
    if (!isEditing || !elRef.current) return;
    if (toolbarActiveRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (toolbarActiveRef.current) return;
      setSelectionCoords(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!elRef.current.contains(range.commonAncestorContainer)) {
      if (toolbarActiveRef.current) return;
      setSelectionCoords(null);
      return;
    }
    const text = range.toString();
    if (!text || text.trim().length === 0) {
      if (toolbarActiveRef.current) return;
      setSelectionCoords(null);
      return;
    }
    savedRangeRef.current = range.cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSelectionCoords({
        x: rect.left + rect.width / 2,
        y: rect.top,
        bottom: rect.bottom,
      });

      let parentSpan = range.commonAncestorContainer;
      if (parentSpan.nodeType === 3) {
        parentSpan = parentSpan.parentElement;
      }
      const isBold =
        document.queryCommandState?.("bold") ||
        parentSpan?.style?.fontWeight === "bold" ||
        parentSpan?.style?.fontWeight === "700" ||
        parentSpan?.closest?.("b, strong") != null;
      const isItalic =
        document.queryCommandState?.("italic") ||
        parentSpan?.style?.fontStyle === "italic" ||
        parentSpan?.closest?.("i, em") != null;
      const isUnderline =
        document.queryCommandState?.("underline") ||
        parentSpan?.style?.textDecoration?.includes("underline") ||
        parentSpan?.closest?.("u") != null;
      const isStrike =
        document.queryCommandState?.("strikeThrough") ||
        parentSpan?.style?.textDecoration?.includes("line-through") ||
        parentSpan?.closest?.("s, strike") != null;
      const color = parentSpan?.style?.color || undefined;
      const spanWithFont = parentSpan?.closest?.("[style*='font-family']");
      const spanFont = spanWithFont?.style?.fontFamily || parentSpan?.style?.fontFamily;
      let resolvedFont = spanFont
        ? spanFont.split(",")[0].replace(/['"]/g, "").trim()
        : null;

      if (!resolvedFont && parentSpan && typeof window !== "undefined") {
        try {
          const comp = window.getComputedStyle(parentSpan).fontFamily;
          if (comp) {
            resolvedFont = comp.split(",")[0].replace(/['"]/g, "").trim();
          }
        } catch {}
      }

      const activeFont = resolvedFont || t.fontFamily || node.text?.fontFamily || "Inter";

      setActiveFormats({
        isBold: Boolean(isBold),
        isItalic: Boolean(isItalic),
        isUnderline: Boolean(isUnderline),
        isStrike: Boolean(isStrike),
        color,
        fontFamily: activeFont,
      });
    }
  };

  useEffect(() => {
    if (!isEditing) {
      setSelectionCoords(null);
      return;
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [isEditing]);

  const applyStyleToSelection = (stylePatch) => {
    toolbarActiveRef.current = true;
    const sel = window.getSelection();
    let range = null;
    if (
      sel &&
      sel.rangeCount > 0 &&
      !sel.isCollapsed &&
      elRef.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
    ) {
      range = sel.getRangeAt(0);
    } else if (
      savedRangeRef.current &&
      elRef.current?.contains(savedRangeRef.current.commonAncestorContainer)
    ) {
      range = savedRangeRef.current;
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (!range || !elRef.current) return;

    const newRange = applyStyleToRange(elRef.current, range, stylePatch);
    if (newRange) {
      savedRangeRef.current = newRange.cloneRange();
    }

    // Save active range
    try {
      const activeRange = newRange || (sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : range);
      savedRangeRef.current = activeRange.cloneRange();
      elRef.current.focus();

      // Update coordinates immediately to keep toolbar in position
      const rect = activeRange.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSelectionCoords({
          x: rect.left + rect.width / 2,
          y: rect.top,
          bottom: rect.bottom,
        });
      }
    } catch {}

    // Persist clean HTML to store
    const cleanedHtml = cleanAndNormalizeHtml(elRef.current.innerHTML);
    const rawText = elRef.current.innerText ?? "";
    const cleanText = rawText.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const hasSpans = /<span[^>]*style=/i.test(cleanedHtml);
    const patch = {
      content: cleanText,
      html: hasSpans ? cleanedHtml : undefined,
    };
    if (hasSpans) {
      const fsMatch = cleanedHtml.match(/font-size:\s*(\d+(?:\.\d+)?)\s*px/i);
      if (fsMatch && fsMatch[1]) {
        const parsed = parseFloat(fsMatch[1]);
        if (parsed > 0) patch.fontSize = parsed;
      }
      const fams = extractFontFamiliesFromHtml(cleanedHtml);
      if (fams.length > 0) patch.fontFamily = fams[0];
    }
    patchNodeText(node.id, patch);

    setTimeout(() => {
      toolbarActiveRef.current = false;
      handleSelectionChange();
    }, 10);
  };

  const clearFormattingOnSelection = () => {
    toolbarActiveRef.current = true;
    const sel = window.getSelection();
    let range =
      sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : savedRangeRef.current;
    if (!range || !elRef.current) return;

    const text = range.toString();
    const textNode = document.createTextNode(text);
    range.deleteContents();
    range.insertNode(textNode);
    normalizeElement(elRef.current);

    const newRange = document.createRange();
    newRange.selectNodeContents(textNode);
    sel.removeAllRanges();
    sel.addRange(newRange);
    savedRangeRef.current = newRange.cloneRange();
    elRef.current.focus();

    const cleanedHtml = cleanAndNormalizeHtml(elRef.current.innerHTML);
    const rawText = elRef.current.innerText ?? "";
    const cleanText = rawText.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const hasSpans = /<span[^>]*style=/i.test(cleanedHtml);
    const patch = {
      content: cleanText,
      html: hasSpans ? cleanedHtml : undefined,
    };
    if (hasSpans) {
      const fsMatch = cleanedHtml.match(/font-size:\s*(\d+(?:\.\d+)?)\s*px/i);
      if (fsMatch && fsMatch[1]) {
        const parsed = parseFloat(fsMatch[1]);
        if (parsed > 0) patch.fontSize = parsed;
      }
      const fams = extractFontFamiliesFromHtml(cleanedHtml);
      if (fams.length > 0) patch.fontFamily = fams[0];
    }
    patchNodeText(node.id, patch);

    const rect = newRange.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSelectionCoords({
        x: rect.left + rect.width / 2,
        y: rect.top,
        bottom: rect.bottom,
      });
    }

    setTimeout(() => {
      toolbarActiveRef.current = false;
      handleSelectionChange();
    }, 10);
  };

  useLayoutEffect(() => {
    if (!elRef.current) return;
    if (!isEditing) {
      if (t.html) {
        let cleanHtml = cleanAndNormalizeHtml(t.html);
        if (activeTruncate && !isLineClamped) {
          cleanHtml = cleanHtml.replace(/<br\s*\/?>/gi, " ");
        }
        elRef.current.innerHTML = cleanHtml;
      } else if (t.content) {
        if (activeTruncate && !isLineClamped) {
          elRef.current.innerHTML = t.content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\r?\n/g, " ");
        } else {
          elRef.current.innerHTML = t.content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
        }
      } else {
        elRef.current.innerHTML = "";
      }
    }
  }, [isEditing, t.html, t.content, activeTruncate, isLineClamped]);

  useEffect(() => {
    if (isEditing && elRef.current) {
      if (t.html) {
        elRef.current.innerHTML = cleanAndNormalizeHtml(t.html);
      } else if (t.content) {
        elRef.current.innerHTML = t.content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
      } else {
        elRef.current.innerHTML = "";
      }
      normalizeElement(elRef.current);
      elRef.current.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(elRef.current);
        if (!t.content && !t.html) {
          range.collapse(false);
        }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        savedRangeRef.current = range.cloneRange();
      } catch {}
    }
  }, [isEditing]);

  const commit = () => {
    if (elRef.current) {
      // Reliably extract text preserving newlines from <br> and <div>/ <p> tags
      let cleanText = "";
      try {
        const clone = elRef.current.cloneNode(true);
        clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        clone.querySelectorAll("div, p").forEach((block) => block.prepend("\n"));
        cleanText = (clone.textContent ?? "").replace(/\r\n/g, "\n").replace(/^\n/, "").replace(/\n$/, "");
      } catch {
        cleanText = (elRef.current.innerText ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "");
      }
      if (!cleanText.trim()) {
        const st = useEditorStore.getState();
        if (typeof st.deleteNodes === "function") {
          st.deleteNodes([node.id]);
        } else if (typeof st.removeNodeTransient === "function") {
          st.removeNodeTransient(node.id);
        }
        setSelectionCoords(null);
        setEditingTextId(null);
        return;
      }
      normalizeElement(elRef.current);
      const cleanedHtml = cleanAndNormalizeHtml(elRef.current.innerHTML);
      const hasSpans = /<span[^>]*style=/i.test(cleanedHtml);
      patchNodeText(node.id, {
        content: cleanText,
        html: hasSpans ? cleanedHtml : undefined,
      });
    }
    setSelectionCoords(null);
    setEditingTextId(null);
  };

  const isNodeHidden = Boolean(
    node.hidden ||
    node.style?.opacity === 0 ||
    common.display === "none" ||
    node.rawStyle?.display === "none" ||
    node.rawStyle?.visibility === "hidden"
  );

  const rawProps = getRawStyleProps(node);
  if (!isNowrap && rawProps.whiteSpace) {
    delete rawProps.whiteSpace;
  }
  if ((node.size?.w?.kind === "fit" || node.size?.w?.kind === "auto" || !node.size?.w) && rawProps.width) {
    delete rawProps.width;
  }

  return (
    <>
      <div
        data-node-id={node.id}
        onDoubleClick={(e) => {
          e.stopPropagation();
          useEditorStore.getState().setSelection([node.id]);
          setEditingTextId(node.id);
        }}
        style={{
          ...common,
          display: isNodeHidden ? "none" : "flex",
          flexDirection: "column",
          justifyContent:
            t.verticalAlign === "middle"
              ? "center"
              : t.verticalAlign === "bottom"
              ? "flex-end"
              : "flex-start",
          boxSizing: "border-box",
          cursor: isEditing ? "text" : common.cursor,
          ...rawProps,
          width: common.width,
          maxWidth: common.maxWidth,
          minWidth: 0,
          overflow: activeTruncate ? "hidden" : (node.rawStyle?.overflow || common.overflow || undefined),
        }}
      >
        <div
          ref={elRef}
          data-text-editor={node.id}
          contentEditable={isEditing}
          suppressContentEditableWarning={true}
          onDoubleClick={(e) => {
            e.stopPropagation();
            useEditorStore.getState().setSelection([node.id]);
            setEditingTextId(node.id);
          }}
          onBlur={(e) => {
            if (!isEditing) return;
            if (toolbarActiveRef.current) {
              toolbarActiveRef.current = false;
              return;
            }
            if (
              e.relatedTarget &&
              (e.relatedTarget.closest?.("[data-rich-text-toolbar]") ||
                document.querySelector("[data-rich-text-toolbar]")?.contains(e.relatedTarget))
            ) {
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (!isEditing) return;
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              commit();
            } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          onPointerDown={(e) => {
            if (isEditing) e.stopPropagation();
          }}
          onMouseDown={(e) => {
            if (isEditing) e.stopPropagation();
          }}
          style={{
            ...textInnerStyle,
            display: isLineClamped ? "-webkit-box" : "block",
            WebkitBoxOrient: isLineClamped ? "vertical" : undefined,
            WebkitLineClamp: isLineClamped ? lineClampVal : undefined,
            width: "100%",
            maxWidth: "100%",
            minWidth: isEditing ? "1ch" : 0,
            minHeight: isEditing ? "1em" : undefined,
            boxSizing: "border-box",
            userSelect: isEditing ? "text" : "none",
            cursor: isEditing ? "text" : (common.cursor || "var(--cursor-default, default)"),
            outline: "none",
            whiteSpace: activeTruncate ? "nowrap" : (isNowrap ? "nowrap" : "pre-wrap"),
            overflow: (activeTruncate || isLineClamped || node.rawStyle?.overflow === "hidden") ? "hidden" : undefined,
            textOverflow: activeTruncate ? "ellipsis" : (node.rawStyle?.["text-overflow"] || undefined),
          }}
        />
      </div>

      {isEditing && selectionCoords && (
        <TextFormatToolbar
          coords={selectionCoords}
          activeFormats={activeFormats}
          defaultFontFamily={t.fontFamily || node.text?.fontFamily || "Inter"}
          onApplyStyle={applyStyleToSelection}
          onClearFormatting={clearFormattingOnSelection}
          onClose={() => setSelectionCoords(null)}
          onInteractionStart={() => {
            toolbarActiveRef.current = true;
          }}
          onInteractionEnd={() => {
            setTimeout(() => {
              toolbarActiveRef.current = false;
            }, 50);
          }}
        />
      )}
    </>
  );
}

export default function CanvasNode({
  node,
  nodes,
  tokens,
  assets = {},
  flexCtx = null,
  zIndexOverride = null,
}) {
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const isSelected = useEditorStore((s) => s.selection.includes(node?.id));
  if (!node || node.hidden || node.visible === false || node.style?.opacity === 0) return null;

  const isRootFrame = (node.type === "frame" || node.type === "rect") && (node.parentId === null || !node.parentId);
  const isFlex = node.layout?.mode === "flex";
  const isGrid = node.layout?.mode === "grid";
  const isContainer = node.type === "frame" || isFlex || isGrid;

  // -- box geometry ---------------------------------------------------------
  const defaultWKind = node.wMode === "Fill" ? "fill" : (node.wMode === "Fit" || node.wMode === "Auto" || node.type === "text") ? "fit" : "fixed";
  const defaultHKind = node.hMode === "Fill" ? "fill" : (node.hMode === "Fit" || node.hMode === "Auto" || node.type === "text") ? "fit" : "fixed";
  const nodeSize = {
    w: node.size?.w || { kind: defaultWKind, px: typeof node.w === "number" ? node.w : 100 },
    h: node.size?.h || { kind: defaultHKind, px: typeof node.h === "number" ? node.h : 100 },
  };
  const rawNodeX = Number(node.position?.x ?? node.x ?? 0);
  const rawNodeY = Number(node.position?.y ?? node.y ?? 0);
  const nodePos = {
    x: Number.isFinite(rawNodeX) ? rawNodeX : 0,
    y: Number.isFinite(rawNodeY) ? rawNodeY : 0,
  };

  const box = {};
  if (zIndexOverride != null) {
    box.zIndex = zIndexOverride;
  }

  // Check for visible child layers
  const visibleChildren = (node.childIds || [])
    .map((cid) => nodes[cid])
    .filter((c) => c && !c.hidden && c.visible !== false && c.style?.opacity !== 0);
  const hasVisibleChildren = visibleChildren.length > 0;

  // Freeform frame content bounds (for non-flex frames hugging children)
  let freeformFitW = null;
  let freeformFitH = null;
  if (isContainer && hasVisibleChildren && !isFlex) {
    const padL = resolveNumeric(node.layout?.padding?.l ?? node.layout?.padding?.h ?? node.padding?.l ?? 0, tokens) || 0;
    const padR = resolveNumeric(node.layout?.padding?.r ?? node.layout?.padding?.h ?? node.padding?.r ?? 0, tokens) || 0;
    const padT = resolveNumeric(node.layout?.padding?.t ?? node.layout?.padding?.v ?? node.padding?.t ?? 0, tokens) || 0;
    const padB = resolveNumeric(node.layout?.padding?.b ?? node.layout?.padding?.v ?? node.padding?.b ?? 0, tokens) || 0;
    let maxR = 0;
    let maxB = 0;
    for (const c of visibleChildren) {
      const cx = c.position?.x ?? 0;
      const cy = c.position?.y ?? 0;
      const cw =
        c.size?.w?.kind === "fixed" && c.size.w.px
          ? c.size.w.px
          : c.type === "text" && c.text
            ? Math.max(1, (c.text.content?.length ?? 0) * (c.text.fontSize ?? 14) * 0.55)
            : (c.size?.w?.px || 100);
      const ch =
        c.size?.h?.kind === "fixed" && c.size.h.px
          ? c.size.h.px
          : c.type === "text" && c.text
            ? (c.text.fontSize ?? 14) * (c.text.lineHeight ?? 1.25)
            : (c.size?.h?.px || 100);
      maxR = Math.max(maxR, cx + cw);
      maxB = Math.max(maxB, cy + ch);
    }
    if (maxR > 0) freeformFitW = maxR + padL + padR;
    if (maxB > 0) freeformFitH = maxB + padT + padB;
  }

  if (flexCtx) {
    // In-flow flex item: lib/flex.js owns size/flex; no left/top.
    // position:relative keeps the element a containing block for its own
    // absolutely-positioned children without affecting flex layout.
    box.position = "relative";
    Object.assign(box, flexCtx.style);
    if (isContainer && (nodeSize.w?.kind === "fit" || nodeSize.w?.kind === "auto")) {
      if (hasVisibleChildren) {
        box.width = isFlex ? "fit-content" : (freeformFitW ? `${freeformFitW}px` : "fit-content");
        delete box.minWidth;
      } else {
        box.width = (nodeSize.w?.px != null && nodeSize.w.px > 0) ? `${nodeSize.w.px}px` : "100px";
        box.minWidth = box.width;
      }
    } else if (node.type === "text" && (nodeSize.w?.kind === "fit" || nodeSize.w?.kind === "auto" || !node.size?.w)) {
      const isNowrap = node.text?.wrap === "none" || node.text?.wrap === "nowrap";
      box.width = isNowrap ? "max-content" : "fit-content";
      const isAbs = !!(node.position?.absolute || node.absolutePosition);
      if (isAbs) {
        box.maxWidth = node.text?.maxWidth ? `${node.text.maxWidth}px` : undefined;
      } else if (node.parentId) {
        const posX = Math.max(0, nodePos.x);
        box.maxWidth = node.text?.maxWidth
          ? `${node.text.maxWidth}px`
          : (posX > 0 ? `calc(100% - ${posX}px)` : "100%");
      }
      box.minWidth = 0;
    } else if (node.type === "text") {
      box.width = flowSizeCss(nodeSize.w, tokens, node);
      const isAbs = !!(node.position?.absolute || node.absolutePosition);
      if (!isAbs && node.parentId) {
        const posX = Math.max(0, nodePos.x);
        box.maxWidth = node.text?.maxWidth
          ? `${node.text.maxWidth}px`
          : (posX > 0 ? `calc(100% - ${posX}px)` : "100%");
      }
      if (node.text?.truncation || nodeSize.w?.kind === "fill") {
        box.minWidth = 0;
      }
    } else if (!box.width) {
      if (nodeSize.w?.kind === "fixed" && nodeSize.w?.px) {
        box.width = `${nodeSize.w.px}px`;
      } else if (nodeSize.w?.kind === "fill") {
        box.width = "100%";
      } else if (typeof node.w === "number" && node.w > 0) {
        box.width = `${node.w}px`;
      }
    }
    if (isContainer && (nodeSize.h?.kind === "fit" || nodeSize.h?.kind === "auto")) {
      if (hasVisibleChildren) {
        box.height = isFlex ? "fit-content" : (freeformFitH ? `${freeformFitH}px` : "fit-content");
        delete box.minHeight;
      } else {
        box.height = (nodeSize.h?.px != null && nodeSize.h.px > 0) ? `${nodeSize.h.px}px` : "100px";
        box.minHeight = box.height;
      }
    } else if (node.type === "text" && (nodeSize.h?.kind === "fit" || nodeSize.h?.kind === "auto")) {
      box.height = "fit-content";
      delete box.minHeight;
    } else if (node.type === "text") {
      box.height = flowSizeCss(nodeSize.h, tokens, node);
      if (nodeSize.h?.kind === "fixed" && nodeSize.h.px) {
        box.minHeight = `${nodeSize.h.px}px`;
      }
    } else if (!box.height) {
      if (nodeSize.h?.kind === "fixed" && nodeSize.h?.px) {
        box.height = `${nodeSize.h.px}px`;
      } else if (nodeSize.h?.kind === "fill") {
        box.height = "100%";
      } else if (typeof node.h === "number" && node.h > 0) {
        box.height = `${node.h}px`;
      }
    }
  } else {
    box.position = "absolute";
    const parentNode = node.parentId ? nodes[node.parentId] : null;
    const isAbsoluteConstraint = Boolean(node.parentId && node.position?.absolute && parentNode);
    if (isAbsoluteConstraint) {
      const parentW = Number(parentNode.size?.w?.px) || Number(parentNode.w) || 0;
      const parentH = Number(parentNode.size?.h?.px) || Number(parentNode.h) || 0;
      const nodeW = Number(node.size?.w?.px) || Number(node.w) || 100;
      const nodeH = Number(node.size?.h?.px) || Number(node.h) || 100;

      const hC = node.constraints?.horizontal || "start";
      const vC = node.constraints?.vertical || "start";

      if (parentW > 0 && parentH > 0) {
        if (hC === "end") {
          box.right = parentW - (nodePos.x + nodeW);
        } else if (hC === "center") {
          const offsetFromCenter = nodePos.x - (parentW - nodeW) / 2;
          box.left = `calc(50% + ${Math.round(offsetFromCenter)}px)`;
        } else if (hC === "stretch") {
          box.left = nodePos.x;
          box.right = parentW - (nodePos.x + nodeW);
        } else {
          box.left = nodePos.x;
        }

        if (vC === "end") {
          box.bottom = parentH - (nodePos.y + nodeH);
        } else if (vC === "center") {
          const offsetFromCenter = nodePos.y - (parentH - nodeH) / 2;
          box.top = `calc(50% + ${Math.round(offsetFromCenter)}px)`;
        } else if (vC === "stretch") {
          box.top = nodePos.y;
          box.bottom = parentH - (nodePos.y + nodeH);
        } else {
          box.top = nodePos.y;
        }
      } else {
        box.left = nodePos.x;
        box.top = nodePos.y;
      }
    } else {
      box.left = nodePos.x;
      box.top = nodePos.y;
    }
    if (isContainer && (nodeSize.w?.kind === "fit" || nodeSize.w?.kind === "auto")) {
      if (hasVisibleChildren) {
        box.width = isFlex ? "fit-content" : (freeformFitW ? `${freeformFitW}px` : "fit-content");
        delete box.minWidth;
      } else {
        box.width = (nodeSize.w?.px != null && nodeSize.w.px > 0) ? `${nodeSize.w.px}px` : "100px";
        box.minWidth = box.width;
      }
    } else if (node.type === "text" && (nodeSize.w?.kind === "fit" || nodeSize.w?.kind === "auto" || !node.size?.w)) {
      const isNowrap = node.text?.wrap === "none" || node.text?.wrap === "nowrap";
      box.width = isNowrap ? "max-content" : "fit-content";
      const isAbs = !!(node.position?.absolute || node.absolutePosition);
      if (isAbs) {
        box.maxWidth = node.text?.maxWidth ? `${node.text.maxWidth}px` : undefined;
      } else if (node.parentId) {
        const posX = Math.max(0, nodePos.x);
        box.maxWidth = node.text?.maxWidth
          ? `${node.text.maxWidth}px`
          : (posX > 0 ? `calc(100% - ${posX}px)` : "100%");
      }
      box.minWidth = 0;
    } else if (node.type === "text") {
      box.width = flowSizeCss(nodeSize.w, tokens, node);
      const isAbs = !!(node.position?.absolute || node.absolutePosition);
      if (!isAbs && node.parentId) {
        const posX = Math.max(0, nodePos.x);
        box.maxWidth = node.text?.maxWidth
          ? `${node.text.maxWidth}px`
          : (posX > 0 ? `calc(100% - ${posX}px)` : "100%");
      }
      if (node.text?.truncation || nodeSize.w?.kind === "fill") {
        box.minWidth = 0;
      }
    } else {
      box.width = flowSizeCss(nodeSize.w, tokens, node);
    }
    if (isContainer && (nodeSize.h?.kind === "fit" || nodeSize.h?.kind === "auto")) {
      if (hasVisibleChildren) {
        box.height = isFlex ? "fit-content" : (freeformFitH ? `${freeformFitH}px` : "fit-content");
        delete box.minHeight;
      } else {
        box.height = (nodeSize.h?.px != null && nodeSize.h.px > 0) ? `${nodeSize.h.px}px` : "100px";
        box.minHeight = box.height;
      }
    } else if (node.type === "text" && (nodeSize.h?.kind === "fit" || nodeSize.h?.kind === "auto")) {
      box.height = "fit-content";
    } else if (node.type === "text") {
      box.height = flowSizeCss(nodeSize.h, tokens, node);
      if (nodeSize.h?.kind === "fixed" && nodeSize.h.px) {
        box.minHeight = `${nodeSize.h.px}px`;
      }
    } else {
      box.height = flowSizeCss(nodeSize.h, tokens, node);
    }
  }

  const common = {
    ...box,
    ...styleProps(node, tokens),
    userSelect: "none",
    boxSizing: "border-box",
    pointerEvents: node.locked ? "none" : "auto",
    ...(node.clipContent || node.style?.overflow === "hidden" ? { overflow: "hidden" } : {}),
    ...(node.hidden || node.style?.opacity === 0 ? { display: "none" } : {}),
  };
  // Canvas elements must never display internal scrollbars
  if (common.overflow === "scroll" || common.overflow === "auto") delete common.overflow;
  if (common.overflowX === "scroll" || common.overflowX === "auto") delete common.overflowX;
  if (common.overflowY === "scroll" || common.overflowY === "auto") delete common.overflowY;
  if (isRootFrame) {
    delete common.overflow;
    delete common.overflowX;
    delete common.overflowY;
  }

  let body;
  if (node.type === "path") {
    // M4: the bézier curve is an <svg> filling the node box; the viewBox
    // is the anchors' own bounds so node-local coords map 1:1. The fill
    // only paints when the path is closed (and gradient fills degrade to
    // their first stop colour, like codegen does). The stroke is the
    // node's style.stroke — deliberately NOT non-scaling: inside the
    // transformed world it scales with zoom, like everything else.
    const anchors = node.path?.anchors ?? [];
    const b = pathBounds(anchors);
    const strokePaint = node.style?.stroke;
    const isAbove = (strokePaint?.position ?? "above") === "above";
    const hasStroke = Boolean(
      strokePaint &&
      !strokePaint.hidden &&
      strokePaint.visible !== false &&
      (strokePaint.width ?? 1) > 0
    );
    const strokeColor = hasStroke
      ? (resolvePaintColor(strokePaint.paint ?? strokePaint, tokens) ?? "#000000")
      : "none";

    const fillPaint = node.style?.fills?.[0] || node.style?.fill;
    let hasFill = true;
    if (node.style?.fills) {
      hasFill = Boolean(node.style.fills.find((f) => f && f.visible !== false && !f.hidden));
    } else if (fillPaint) {
      hasFill = fillPaint.visible !== false && !fillPaint.hidden;
    } else if (!node.path?.closed && !node.d) {
      hasFill = false;
    }

    const fillColor = hasFill
      ? (resolvePaintColor(fillPaint, tokens) ?? (node.path?.closed ? "#000000" : "none"))
      : "none";

    const pathD = node.d || anchorsToD(anchors, node.path?.closed);
    const viewBox = node.d && node.viewBox ? node.viewBox : `0 0 ${Math.max(1, b.w)} ${Math.max(1, b.h)}`;

    body = (
      <div data-node-id={node.id} style={common}>
        <svg
          width="100%"
          height="100%"
          viewBox={viewBox}
          preserveAspectRatio={node.d ? "xMidYMid meet" : "none"}
          style={{ display: "block", overflow: "visible" }}
        >
          <path
            d={pathD}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={hasStroke ? (strokePaint.width ?? 1.2) : 0}
            strokeLinecap={node.strokeLinecap || "round"}
            strokeLinejoin={node.strokeLinejoin || "round"}
            fillRule={node.fillRule || node.style?.fillRule || undefined}
            clipRule={node.clipRule || node.style?.clipRule || undefined}
            style={{
              paintOrder: isAbove ? "fill stroke" : "stroke fill",
              fillRule: node.fillRule || node.style?.fillRule || undefined,
              clipRule: node.clipRule || node.style?.clipRule || undefined,
            }}
          />
        </svg>
      </div>
    );
  } else if (node.type === "svg") {
    const children = (node.childIds || [])
      .map((id) => nodes[id])
      .filter(Boolean);

    const renderSvgElement = (child) => {
      if (!child) return null;

      if (child.type === "group") {
        const groupChildren = (child.childIds || [])
          .map((id) => nodes[id])
          .filter(Boolean);

        const groupFill = child.style?.fill
          ? resolvePaintColor(child.style.fill, tokens)
          : undefined;
        const groupStroke = child.style?.stroke
          ? resolvePaintColor(child.style.stroke.paint ?? child.style.stroke, tokens)
          : undefined;

        return (
          <g
            key={child.id}
            data-node-id={child.id}
            transform={child.transform || undefined}
            opacity={child.style?.opacity ?? 1}
            fill={groupFill}
            stroke={groupStroke}
            fillRule={child.fillRule || child.style?.fillRule || undefined}
            clipRule={child.clipRule || child.style?.clipRule || undefined}
            style={{
              fillRule: child.fillRule || child.style?.fillRule || undefined,
              clipRule: child.clipRule || child.style?.clipRule || undefined,
            }}
          >
            {groupChildren.map(renderSvgElement)}
          </g>
        );
      }

      if (
        child.type === "path" ||
        child.type === "polygon" ||
        child.type === "polyline" ||
        child.type === "circle" ||
        child.type === "rect" ||
        child.type === "ellipse" ||
        child.type === "line"
      ) {
        const strokePaint = child.style?.stroke;
        const fillPaint = child.style?.fills?.[0] || child.style?.fill;

        // Visibility check for stroke
        const hasStroke = Boolean(
          strokePaint &&
          !strokePaint.hidden &&
          strokePaint.visible !== false &&
          (strokePaint.width ?? 1) > 0
        );
        const strokeColor = hasStroke
          ? (resolvePaintColor(strokePaint?.paint ?? strokePaint, tokens) || child.stroke || "#000000")
          : "none";
        const strokeWidth = hasStroke
          ? (strokePaint?.width ?? child.strokeWidth ?? 1.3)
          : 0;

        // Visibility check for fill
        let hasFill = true;
        if (child.style?.fills) {
          hasFill = Boolean(child.style.fills.find((f) => f && f.visible !== false && !f.hidden));
        } else if (fillPaint) {
          hasFill = fillPaint.visible !== false && !fillPaint.hidden;
        } else if (child.fill === "none" || child.fill === null) {
          hasFill = false;
        }

        const fillColor = hasFill
          ? (resolvePaintColor(fillPaint, tokens) || (child.fill && child.fill !== "none" ? child.fill : (hasStroke ? "none" : "#18181B")))
          : "none";

        return (
          <path
            key={child.id}
            data-node-id={child.id}
            d={
              child.d ||
              (child.path?.anchors
                ? anchorsToD(child.path.anchors, child.path.closed)
                : "")
            }
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap={child.strokeLinecap || "round"}
            strokeLinejoin={child.strokeLinejoin || "round"}
            transform={child.transform || undefined}
            opacity={child.style?.opacity ?? 1}
            fillRule={child.fillRule || child.style?.fillRule || undefined}
            clipRule={child.clipRule || child.style?.clipRule || undefined}
            style={{
              fillRule: child.fillRule || child.style?.fillRule || undefined,
              clipRule: child.clipRule || child.style?.clipRule || undefined,
            }}
          />
        );
      }

      return null;
    };

    const isNodeHidden = Boolean(
      node.hidden ||
      node.style?.opacity === 0 ||
      common.display === "none" ||
      node.rawStyle?.display === "none" ||
      node.rawStyle?.visibility === "hidden"
    );
    const markup = node.svgOuterHtml || node.svgMarkup || node.rawSvg;
    const svgColor = node.color || node.style?.color || "currentColor";
    const svgFill = node.fill || node.style?.fill || "currentColor";

    body = (
      <div
        data-node-id={node.id}
        style={{
          ...common,
          border: "none",        // SVG nodes must never show CSS borders
          outline: "none",
          color: svgColor,
          display: isNodeHidden ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "visible",
          ...getRawStyleProps(node),
        }}
      >
        {children.length > 0 ? (
          <svg
            viewBox={node.viewBox || node.rawSvg?.match(/viewbox\s*=\s*["']?([^"'>]+)["']?/i)?.[1] || node.svgMarkup?.match(/viewbox\s*=\s*["']?([^"'>]+)["']?/i)?.[1] || `0 0 ${node.size?.w?.px || 16} ${node.size?.h?.px || 16}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            fill={svgFill}
            fillRule={node.fillRule || undefined}
            clipRule={node.clipRule || undefined}
            style={{
              display: "block",
              overflow: "visible",
              fillRule: node.fillRule || undefined,
              clipRule: node.clipRule || undefined,
              color: svgColor,
            }}
          >
            {children.map(renderSvgElement)}
          </svg>
        ) : markup ? (
          <div
            className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ) : (
          <svg
            viewBox={node.viewBox || node.rawSvg?.match(/viewbox\s*=\s*["']?([^"'>]+)["']?/i)?.[1] || node.svgMarkup?.match(/viewbox\s*=\s*["']?([^"'>]+)["']?/i)?.[1] || `0 0 ${node.size?.w?.px || 16} ${node.size?.h?.px || 16}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            fill={svgFill}
            fillRule={node.fillRule || undefined}
            clipRule={node.clipRule || undefined}
            style={{
              display: "block",
              overflow: "visible",
              fillRule: node.fillRule || undefined,
              clipRule: node.clipRule || undefined,
              color: svgColor,
            }}
          >
            {node.svgInnerHtml ? (
              <g dangerouslySetInnerHTML={{ __html: node.svgInnerHtml }} />
            ) : (
              children.map(renderSvgElement)
            )}
          </svg>
        )}
      </div>
    );
  } else if (node.type === "shader") {
    // M5: the WebGL island. The wrapper div carries every generic style
    // prop (opacity, blend, shadows, filters, radius via `common`);
    // ShaderNode paints the box itself with our mesh-gradient shader —
    // or a CSS gradient composite when WebGL is unavailable.
    body = (
      <div data-node-id={node.id} style={common}>
        <ShaderNode node={node} />
      </div>
    );
  } else if (node.type === "image" || node.type === "video") {
    // Paints asset as background or as HTML5 video element when source is video
    const imgFill = node.style?.fills?.find((f) => f && f.kind === "image" && f.visible !== false) || (node.style?.fill?.kind === "image" ? node.style.fill : null);
    const url = (node.image ? (assets[node.image.assetId] || node.image.url) : null)
      || (imgFill ? (assets[imgFill.assetId] || imgFill.url) : null)
      || node.src
      || (node.video?.url || node.style?.fill?.url || undefined);
    const fit = imgFill?.fit || node.image?.fit || node.style?.fill?.fit || "cover";
    const isVideoFile = url && (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) || node.type === "video");

    if (isVideoFile) {
      body = (
        <div
          data-node-id={node.id}
          style={{
            ...common,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            src={url}
            autoPlay
            muted
            loop
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: fit === "tile" ? "none" : fitCss(fit),
              pointerEvents: "none",
              display: "block",
            }}
          />
        </div>
      );
    } else {
      body = (
        <div
          data-node-id={node.id}
          style={{
            ...common,
            backgroundImage: url ? `url("${url}")` : undefined,
            backgroundSize: fitCss(fit),
            backgroundPosition: "center",
            backgroundRepeat: fit === "tile" ? "repeat" : "no-repeat",
            ...fillProps(node, tokens, assets),
            ...getRawStyleProps(node),
          }}
        />
      );
    }
  } else if (node.type === "text") {
    body = <TextNodeContent node={node} tokens={tokens} common={common} />;
  } else if (node.type === "ellipse") {
    // Ellipse: a box with 50% border-radius so it renders as a true
    // oval/circle regardless of aspect ratio.
    body = (
      <div
        data-node-id={node.id}
        style={{
          ...common,
          ...fillProps(node, tokens, assets),
          borderRadius: "50%",
          ...getRawStyleProps(node),
          ...(isNodeHidden ? { display: "none" } : {}),
        }}
      />
    );
  } else {
    const children = node.childIds
      .map((id) => nodes[id])
      .filter(Boolean);

    let containerProps = {};
    let childCtx = new Map(); // childId -> flexCtx | null
    if (isFlex) {
      const layout = node.layout;
      const gap = resolveNumeric(layout.gap, tokens);
      const padTop = resolveNumeric(layout.padding?.t ?? layout.padding?.v ?? 0, tokens);
      const padRight = resolveNumeric(layout.padding?.r ?? layout.padding?.h ?? 0, tokens);
      const padBottom = resolveNumeric(layout.padding?.b ?? layout.padding?.v ?? 0, tokens);
      const padLeft = resolveNumeric(layout.padding?.l ?? layout.padding?.h ?? 0, tokens);
      containerProps = {
        display: "flex",
        flexDirection: flexDirection(layout),
        flexWrap: layout.wrap ? "wrap" : "nowrap",
        gap,
        padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
        justifyContent: justifyContent(layout.alignMain),
        alignItems: alignItems(layout.alignCross),
      };
      const mainAxis = layout.direction === "row" ? "w" : "h";
      const flow = inFlowChildren(children);
      const fillIdx = firstFillIndex(children, mainAxis);
      const firstFillId = fillIdx >= 0 ? flow[fillIdx].id : null;
      for (const child of children) {
        childCtx.set(
          child.id,
          child.position?.absolute
            ? null
            : {
              style: flexChildStyle(
                child,
                layout,
                tokens,
                child.id === firstFillId,
              ),
            },
        );
      }
    } else if (isGrid) {
      const layout = node.layout;
      containerProps = gridContainerStyle(layout, tokens);
      for (const child of children) {
        childCtx.set(
          child.id,
          child.position?.absolute
            ? null
            : {
              style: gridChildStyle(child, layout),
            },
        );
      }
    }

    const isNodeHidden = Boolean(
      node.hidden ||
      node.style?.opacity === 0 ||
      common.display === "none" ||
      node.rawStyle?.display === "none" ||
      node.rawStyle?.visibility === "hidden"
    );

    body = (
      <div
        data-node-id={node.id}
        style={{
          ...common,
          ...getRawStyleProps(node),
          ...fillProps(node, tokens, assets),
          ...containerProps,
          ...(isNodeHidden ? { display: "none" } : {}),
        }}
      >
        {!isFlex && !isGrid ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          >
            {children.map((child, idx) => (
              <CanvasNode
                key={child.id}
                node={child}
                nodes={nodes}
                tokens={tokens}
                assets={assets}
                flexCtx={null}
                zIndexOverride={children.length - idx}
              />
            ))}
          </div>
        ) : (
          children.map((child, idx) => (
            <CanvasNode
              key={child.id}
              node={child}
              nodes={nodes}
              tokens={tokens}
              assets={assets}
              flexCtx={childCtx.get(child.id) ?? null}
              zIndexOverride={children.length - idx}
            />
          ))
        )}
        {node.type === "frame" && <GuideOverlays node={node} />}
      </div>
    );
  }

  // Root frames get a name label above them, like design tools show.
  if (isRootFrame) {
    return (
      <>
        <FrameNameLabel node={node} isSelected={isSelected} />
        {body}
      </>
    );
  }
  return body;
}

/** Text nodes take their colour from the fill paint (not a background). */
function fillPropsAsColor(node, tokens) {
  let fill = null;
  if (Array.isArray(node.style?.fills) && node.style.fills.length) {
    fill = node.style.fills.find((f) => f && f.visible !== false && !f.hidden);
  } else if (node.style?.fill && node.style.fill.visible !== false && !node.style.fill.hidden) {
    fill = node.style.fill;
  }
  if (!fill) {
    fill = node.style?.color || node.text?.color;
  }
  if (!fill) return {};
  if (typeof fill === "string") return { color: fill };
  if (fill.kind === "gradient") {
    const grad = buildGradientCss(fill);
    if (grad) {
      return {
        backgroundImage: grad,
        WebkitBackgroundImage: grad,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
      };
    }
  }
  const color = resolvePaintColor(fill, tokens);
  return color ? { color } : {};
}
