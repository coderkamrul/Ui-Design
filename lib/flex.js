/**
 * Flex layout math (M2) — the deliberately small flex model from the spec
 * (Phase 1 v2.2): direction + reverse, wrap, ONE gap, padding H/V, a 3×3
 * alignment grid, and child sizing of Fixed / Fit / Fill / Relative.
 *
 * THE SPEC RULE that overrides native flexbox: on the main axis, Fill does
 * NOT share space. The FIRST in-flow Fill child takes all the remaining
 * space; every later Fill child collapses to 0 on that axis.
 *
 * This module is import-free and pure (tokens are resolved with a local
 * alias-chain walk mirroring lib/model.js `resolveToken`) so it runs in the
 * browser, in Next's build, and in scripts/model-test.mjs.
 */

/** Local alias-chain token resolution (mirrors lib/model.js). */
export function resolveTokenValue(tokens, id) {
  let token = (tokens ?? []).find((t) => t.id === id);
  const seen = new Set();
  while (token && token.aliasOf && !seen.has(token.id)) {
    seen.add(token.id);
    token = tokens.find((t) => t.id === token.aliasOf);
  }
  return token ? token.value : undefined;
}

/** Resolve `number | { tokenId }` to a number (0 when unresolvable). */
export function resolveNumeric(v, tokens) {
  if (typeof v === "number") return v;
  if (v != null && typeof v === "object" && typeof v.tokenId === "string") {
    const resolved = resolveTokenValue(tokens, v.tokenId);
    return typeof resolved === "number" ? resolved : 0;
  }
  return 0;
}

/** Children that participate in flex flow (not absolutely positioned, not hidden). */
export function inFlowChildren(children) {
  return children.filter((c) => !c.position?.absolute && !c.hidden && c.visible !== false && c.style?.opacity !== 0);
}

/**
 * Main-axis sizes for a flex container — the pure form of the spec's Fill
 * rule, used by the tests; the renderer expresses the same rule through
 * flex styles (first Fill child `flex: 1 1 0`, later ones `flex: 0 0 0px`).
 *
 * @param {Object} args
 * @param {number} args.containerMain Inner-box main size of the container
 *   MINUS nothing — padding is passed separately and subtracted here.
 * @param {number} args.paddingMain Total main-axis padding (both sides).
 * @param {number} args.gap Resolved gap px (applied between in-flow items).
 * @param {Array<{ sizing: Object, fitPx?: number }>} args.items In-flow
 *   children in order; `sizing` is the child's main-axis Sizing, `fitPx`
 *   the measured content size for Fit children.
 * @returns {number[]} Main-axis px size per item (Fit returns its fitPx).
 */
export function flexMainSizes({ containerMain, paddingMain, gap, items }) {
  const content = Math.max(0, containerMain - paddingMain);
  const gapsTotal = gap * Math.max(0, items.length - 1);
  let used = gapsTotal;
  for (const item of items) {
    const s = item.sizing;
    if (s.kind === "fixed") used += s.px;
    else if (s.kind === "token") used += item.tokenPx ?? 0;
    else if (s.kind === "relative") used += (content * s.pct) / 100;
    else if (s.kind === "fit" || s.kind === "auto") used += item.fitPx ?? 0;
  }
  const remaining = Math.max(0, content - used);
  let fillSeen = false;
  return items.map((item) => {
    const s = item.sizing;
    switch (s.kind) {
      case "fixed":
        return s.px;
      case "token":
        return item.tokenPx ?? 0;
      case "relative":
        return (content * s.pct) / 100;
      case "fit":
      case "auto":
        return item.fitPx ?? 0;
      case "fill": {
        if (fillSeen) return 0;
        fillSeen = true;
        return remaining;
      }
      default:
        return 0;
    }
  });
}

/**
 * Index (into the in-flow children list) of the first Fill child on the
 * given axis, or -1. The renderer uses this to hand the remaining space to
 * exactly one child.
 */
export function firstFillIndex(children, axis) {
  const flow = inFlowChildren(children);
  return flow.findIndex((c) => c.size?.[axis]?.kind === "fill");
}

/**
 * Drag-reorder slot (depth-gap batch): given the rects of the OTHER
 * siblings in flow order and a pointer position in the SAME coordinate
 * space (canvas coords on the canvas, client coords in the Layers
 * panel), return the insertion index into that list — the count of
 * siblings whose main-axis midpoint is before `pos`. 0 = before the
 * first sibling, siblingRects.length = after the last. Callers build
 * the rect list in VISUAL order along the axis (measured DOM rects),
 * which is what makes flex `reverse` and multi-row wrap work through
 * the same main-axis projection (a documented simplification for
 * wrapped rows: the projection ignores which row a sibling sits in).
 */
export function insertionIndex(siblingRects, axis, pos) {
  let idx = 0;
  for (const r of siblingRects ?? []) {
    if (!r) continue;
    const mid = axis === "x" ? r.x + r.w / 2 : r.y + r.h / 2;
    if (mid < pos) idx++;
  }
  return idx;
}

/**
 * Move `id` within a sibling id list. `insertIndex` is expressed in
 * the list WITHOUT `id` (0..len-1 — the space insertionIndex returns).
 * Returns the new array, or null when the move is a no-op (id missing,
 * or it lands exactly where it started) so callers can skip history
 * commits for position-preserving drops.
 */
export function reorderList(ids, id, insertIndex) {
  if (!Array.isArray(ids) || !ids.includes(id)) return null;
  const others = ids.filter((x) => x !== id);
  const at = Math.max(
    0,
    Math.min(others.length, Math.round(insertIndex) || 0),
  );
  const next = [...others.slice(0, at), id, ...others.slice(at)];
  return next.every((v, i) => v === ids[i]) ? null : next;
}

/** alignMain value -> CSS justify-content. */
export function justifyContent(alignMain) {
  switch (alignMain) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    case "space-evenly":
      return "space-evenly";
    case "start":
    default:
      return "flex-start";
  }
}

/** alignCross value -> CSS align-items. */
export function alignItems(alignCross) {
  switch (alignCross) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    case "baseline":
    case "first baseline":
      return "first baseline";
    case "last baseline":
      return "last baseline";
    case "start":
    default:
      return "flex-start";
  }
}

/** flex-direction CSS value from direction + reverse. */
export function flexDirection(layout) {
  const base = layout.direction === "row" ? "row" : "column";
  return layout.reverse ? `${base}-reverse` : base;
}

/**
 * CSS size for one axis of a node OUTSIDE flex flow (freeform children,
 * root nodes, absolute flex children). Returns a CSS length or undefined
 * (auto). `pctBase` is unused — relative sizes become CSS % of the parent.
 */
export function flowSizeCss(sizing, tokens, node) {
  if (!sizing) return undefined;
  switch (sizing.kind) {
    case "fixed":
      return sizing.px;
    case "token": {
      const v = resolveTokenValue(tokens, sizing.tokenId);
      return typeof v === "number" ? v : undefined;
    }
    case "relative":
      return `${sizing.pct}%`;
    case "fill":
      return "100%";
    case "fit":
    case "auto":
      if (node?.type === "frame") return "fit-content";
      if (node?.type === "text") {
        return (node.text?.wrap === "none" || node.text?.wrap === "nowrap") ? "max-content" : "fit-content";
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Flex-item styles for one in-flow child of a flex frame. Implements the
 * spec's Fill rule on the main axis and stretch-on-Fill for the cross axis.
 *
 * @param {Object} node The child node.
 * @param {Object} layout The parent's flex layout.
 * @param {Array} tokens File tokens (for token sizing).
 * @param {boolean} isFirstFill Whether this child is the first Fill child
 *   on the main axis (see firstFillIndex).
 * @returns {Object} React style props for the child element.
 */
export function flexChildStyle(node, layout, tokens, isFirstFill) {
  const row = layout.direction === "row";
  const mainAxis = row ? "w" : "h";
  const crossAxis = row ? "h" : "w";
  const main = node.size?.[mainAxis];
  const cross = node.size?.[crossAxis];
  const style = { flexShrink: 0 };

  // -- main axis ------------------------------------------------------------
  switch (main?.kind) {
    case "fixed":
      style.flex = `0 0 ${main.px}px`;
      if (row) {
        style.width = main.px;
        style.minWidth = 0;
      } else {
        style.height = main.px;
        style.minHeight = 0;
      }
      break;
    case "token": {
      const v = resolveTokenValue(tokens, main.tokenId);
      const px = typeof v === "number" ? v : 0;
      style.flex = `0 0 ${px}px`;
      if (row) {
        style.width = px;
        style.minWidth = 0;
      } else {
        style.height = px;
        style.minHeight = 0;
      }
      break;
    }
    case "relative":
      style.flex = `0 0 ${main.pct}%`;
      if (row) style.width = `${main.pct}%`;
      else style.height = `${main.pct}%`;
      break;
    case "fill":
      // All Fill children expand to share available space proportionally
      style.flex = "1 1 0px";
      if (row) style.minWidth = 0;
      else style.minHeight = 0;
      break;
    case "fit":
    default:
      // Fit/hug children preserve their content size and never collapse or shrink letter-by-letter
      style.flex = "0 0 auto";
      if (row) {
        if (node?.type === "text") {
          style.width = (node.text?.wrap === "none" || node.text?.wrap === "nowrap") ? "max-content" : "fit-content";
          style.maxWidth = "100%";
          style.minWidth = 0;
        } else {
          style.width = "fit-content";
        }
      }
      break;
  }

  // -- cross axis -------------------------------------------------------------
  const crossSize = (value) => {
    if (row) {
      style.height = value;
      style.minHeight = 0;
    } else {
      style.width = value;
      style.minWidth = 0;
    }
  };
  switch (cross?.kind) {
    case "fixed":
      crossSize(cross.px);
      break;
    case "token": {
      const v = resolveTokenValue(tokens, cross.tokenId);
      if (typeof v === "number") crossSize(v);
      break;
    }
    case "relative":
      crossSize(`${cross.pct}%`);
      break;
    case "fill":
      style.alignSelf = "stretch";
      if (!row) {
        style.width = "100%";
      } else {
        style.height = "100%";
      }
      break;
    case "fit":
    default:
      if (node?.type === "text") {
        if (!row) {
          // In flex column, cross axis is width: text must follow parent width and wrap!
          const isNowrap = node.text?.wrap === "none" || node.text?.wrap === "nowrap";
          style.width = isNowrap ? "max-content" : "100%";
          style.maxWidth = "100%";
          style.minWidth = 0;
          style.height = "fit-content";
        } else {
          crossSize("fit-content");
        }
      } else if (node?.type === "frame" || node?.type === "rect") {
        crossSize("fit-content");
      }
      break;
  }
  return style;
}

/** Approximate width/height of a text node when DOM measurement is not available. */
export function estimateMeasureText(text, fontSize = 16, lineHeight = 1.25) {
  const content = typeof text === "string" ? text : "";
  const lines = content.split("\n");
  let maxLen = 0;
  for (const line of lines) {
    if (line.length > maxLen) maxLen = line.length;
  }
  const w = Math.max(1, Math.round(maxLen * fontSize * 0.58));
  const h = Math.max(1, Math.round(lines.length * fontSize * lineHeight));
  return { w, h };
}

